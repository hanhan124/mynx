//! Mynx job runtime. Every long operation (image conversion, R processes,
//! Excel builds) runs under a [`JobManager`]-registered job with a
//! cooperative cancellation token plus an optional hard-kill hook, the five
//! contract states (queued/running/succeeded/failed/cancelled), and a
//! change-notification channel the app layer forwards to the task center.

use mynx_contracts::task::{TaskKind, TaskRecord, TaskStatus};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// Hard-kill hook for jobs that own external processes (R trees on Windows
/// need `taskkill /T /F`). Called once when cancel is requested.
pub type KillHook = Arc<dyn Fn() + Send + Sync>;

struct JobEntry {
    record: TaskRecord,
    token: CancellationToken,
    kill_hook: Option<KillHook>,
}

impl JobEntry {
    fn record(&self) -> TaskRecord {
        self.record.clone()
    }
}

/// Change notifications the app layer subscribes to (emit `mynx://task-changed`).
pub type ChangeRx = mpsc::UnboundedReceiver<TaskRecord>;
type ChangeTx = mpsc::UnboundedSender<TaskRecord>;

pub struct JobManager {
    next_id: AtomicU64,
    jobs: Mutex<HashMap<u64, JobEntry>>,
    fanout: Mutex<Vec<ChangeTx>>,
}

impl Default for JobManager {
    fn default() -> Self {
        Self::new()
    }
}

impl JobManager {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            jobs: Mutex::new(HashMap::new()),
            fanout: Mutex::new(Vec::new()),
        }
    }

    /// Subscribe to change notifications. The app layer installs a forwarding
    /// task that emits Tauri events for each update.
    pub fn subscribe(&self) -> ChangeRx {
        let (tx, rx) = mpsc::unbounded_channel();
        self.fanout.lock().unwrap().push(tx);
        rx
    }

    /// Register a new job and return its handle.
    pub fn start(&self, kind: TaskKind, label: impl Into<String>) -> JobHandle<'_> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let now = now_ms();
        let record = TaskRecord {
            v: mynx_contracts::WIRE_VERSION,
            id,
            kind,
            label: label.into(),
            status: TaskStatus::Running,
            created_at_ms: now,
            started_at_ms: Some(now),
            finished_at_ms: None,
            progress: None,
            detail: None,
            error: None,
            output_dir: None,
        };
        let token = CancellationToken::new();
        self.jobs.lock().unwrap().insert(
            id,
            JobEntry { record: record.clone(), token: token.clone(), kill_hook: None },
        );
        self.notify(record);
        JobHandle {
            id,
            manager: self,
            token,
            kill_hook_slot: Mutex::new(None),
        }
    }

    /// Test/infrastructure helper: create a job already queued.
    pub fn start_queued(&self, kind: TaskKind, label: impl Into<String>) -> JobHandle<'_> {
        let handle = self.start(kind, label);
        self.update(handle.id, |r| r.status = TaskStatus::Queued);
        handle
    }

    fn notify(&self, record: TaskRecord) {
        for tx in self.fanout.lock().unwrap().iter() {
            let _ = tx.send(record.clone());
        }
    }

    /// Mutate a job's record and publish the change.
    pub fn update(&self, id: u64, f: impl FnOnce(&mut TaskRecord)) {
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(entry) = jobs.get_mut(&id) {
            f(&mut entry.record);
            let snapshot = entry.record();
            drop(jobs);
            self.notify(snapshot);
        }
    }

    /// Request cooperative + hard cancellation.
    pub fn cancel(&self, id: u64) -> bool {
        let jobs = self.jobs.lock().unwrap();
        if let Some(entry) = jobs.get(&id) {
            if let Some(hook) = &entry.kill_hook {
                hook();
            }
            entry.token.cancel();
            true
        } else {
            false
        }
    }

    /// Cancel every live job of one kind (shutdown safety net).
    pub fn cancel_all(&self) {
        let jobs = self.jobs.lock().unwrap();
        for entry in jobs.values() {
            if !entry.record.status.is_terminal() {
                if let Some(hook) = &entry.kill_hook {
                    hook();
                }
                entry.token.cancel();
            }
        }
    }

    /// Current record snapshot.
    pub fn record(&self, id: u64) -> Option<TaskRecord> {
        self.jobs.lock().unwrap().get(&id).map(|e| e.record())
    }

    /// All records, newest first.
    pub fn list(&self) -> Vec<TaskRecord> {
        let mut records: Vec<TaskRecord> =
            self.jobs.lock().unwrap().values().map(|e| e.record()).collect();
        records.sort_by_key(|record| std::cmp::Reverse(record.created_at_ms));
        records
    }

    /// Drop terminal jobs from the registry (task-center GC).
    pub fn prune_finished(&self) {
        self.jobs.lock().unwrap().retain(|_, e| !e.record.status.is_terminal());
    }

    fn install_kill_hook(&self, id: u64, hook: KillHook) {
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(entry) = jobs.get_mut(&id) {
            entry.kill_hook = Some(hook);
        }
    }
}

pub struct JobHandle<'a> {
    pub id: u64,
    manager: &'a JobManager,
    pub token: CancellationToken,
    kill_hook_slot: Mutex<Option<KillHook>>,
}

impl<'a> JobHandle<'a> {
    /// Install the hard-kill hook (must be called before cancel can reach it).
    pub fn on_cancel(&self, hook: KillHook) {
        *self.kill_hook_slot.lock().unwrap() = Some(hook.clone());
        self.manager.install_kill_hook(self.id, hook);
    }

    /// Mark the job as running with a progress fraction.
    pub fn progress(&self, progress: f64) {
        self.manager.update(self.id, |r| {
            r.status = TaskStatus::Running;
            r.progress = Some(progress.clamp(0.0, 1.0));
        });
    }

    pub fn detail(&self, detail: impl Into<String>) {
        let detail = detail.into();
        self.manager.update(self.id, |r| r.detail = Some(detail));
    }

    pub fn output_dir(&self, dir: impl Into<String>) {
        let dir = dir.into();
        self.manager.update(self.id, |r| r.output_dir = Some(dir));
    }

    pub fn succeed(&self) {
        let now = now_ms();
        self.manager.update(self.id, |r| {
            r.status = TaskStatus::Succeeded;
            r.finished_at_ms = Some(now);
            r.progress = Some(1.0);
        });
    }

    pub fn fail(&self, error: impl Into<String>) {
        let now = now_ms();
        let error = error.into();
        self.manager.update(self.id, |r| {
            r.status = TaskStatus::Failed;
            r.finished_at_ms = Some(now);
            r.error = Some(error);
        });
    }

    pub fn cancel(&self) {
        self.manager.cancel(self.id);
    }

    /// Record a cancelled terminal state (after the job observed the token).
    pub fn mark_cancelled(&self) {
        let now = now_ms();
        self.manager.update(self.id, |r| {
            r.status = TaskStatus::Cancelled;
            r.finished_at_ms = Some(now);
        });
    }

    pub fn is_cancelled(&self) -> bool {
        self.token.is_cancelled()
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_transitions_publish_changes() {
        let manager = JobManager::new();
        let mut rx = manager.subscribe();
        let handle = manager.start(TaskKind::ImageConvert, "demo");
        handle.progress(0.5);
        handle.succeed();

        let record = manager.record(handle.id).unwrap();
        assert_eq!(record.status, TaskStatus::Succeeded);
        // succeed() completes the progress bar.
        assert_eq!(record.progress, Some(1.0));

        let mut seen = 0;
        while rx.try_recv().is_ok() {
            seen += 1;
        }
        assert!(seen >= 2);
    }

    #[test]
    fn cancel_runs_kill_hook_and_marks_cancelled() {
        let manager = JobManager::new();
        let handle = manager.start(TaskKind::RnaseqRun, "R run");
        let token = handle.token.clone();
        handle.on_cancel(Arc::new(move || {
            token.cancel();
        }));
        manager.cancel(handle.id);
        handle.mark_cancelled();
        assert_eq!(manager.record(handle.id).unwrap().status, TaskStatus::Cancelled);
    }

    #[test]
    fn prune_drops_only_terminal() {
        let manager = JobManager::new();
        let done = manager.start(TaskKind::ChartRun, "done");
        done.succeed();
        let live = manager.start(TaskKind::ChartRun, "live");
        manager.prune_finished();
        assert!(manager.record(done.id).is_none());
        assert!(manager.record(live.id).is_some());
    }
}
