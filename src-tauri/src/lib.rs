use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize,
    Url, WebviewBuilder, WebviewUrl, WindowBuilder, WindowEvent,
};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
mod error;
mod commands;
mod services;
mod tasks;
use error::CommandError;

const SEARCH_TOOLBAR_HEIGHT: u32 = 76;
static SEARCH_ZOOMS: OnceLock<Mutex<HashMap<String, f64>>> = OnceLock::new();

// Runs in the remote search WebView. It keeps browser-like gestures and a
// compact context menu local to the page, without adding another JS package.
const SEARCH_CONTENT_SCRIPT: &str = r#"
(() => {
  let rightDown = null;
  let suppressMenu = false;
  const isEnglish = /^en(?:-|$)/i.test(navigator.language || '');
  const copy = isEnglish ? {
    back: 'Back', forward: 'Forward', reload: 'Reload', open: 'Open link',
    openTab: 'Open link in new tab', copyLink: 'Copy link', print: 'Print page',
    find: 'Find in page', closeFind: 'Close find bar', found: 'Found', notFound: 'Not found'
  } : {
    back: '后退', forward: '前进', reload: '刷新', open: '打开链接',
    openTab: '在新标签打开', copyLink: '复制链接', print: '打印页面',
    find: '在页面中查找', closeFind: '关闭查找', found: '找到', notFound: '未找到'
  };
  const menu = document.createElement('div');
  menu.id = '__mynx_context_menu';
  menu.innerHTML = `<button data-action="back">${copy.back}</button><button data-action="forward">${copy.forward}</button><button data-action="reload">${copy.reload}</button><hr><button data-action="open">${copy.open}</button><button data-action="open-tab">${copy.openTab}</button><button data-action="copy">${copy.copyLink}</button><button data-action="print">${copy.print}</button>`;
  Object.assign(menu.style, { position:'fixed', zIndex:'2147483647', display:'none', minWidth:'150px', padding:'6px', background:'#fff', color:'#17212f', border:'1px solid #dce2e9', borderRadius:'10px', boxShadow:'0 12px 30px rgba(27,39,56,.2)', font:'13px Segoe UI, sans-serif' });
  menu.querySelectorAll('button').forEach((button) => Object.assign(button.style, { display:'block', width:'100%', padding:'8px 12px', border:0, borderRadius:'6px', background:'transparent', color:'inherit', textAlign:'left', cursor:'pointer' }));
  menu.querySelectorAll('hr').forEach((line) => Object.assign(line.style, { border:0, borderTop:'1px solid #edf0f3', margin:'5px 0' }));
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(menu));
  // Search pages frequently use target="_blank" for result links. Keep those
  // links inside this lightweight browser surface so a second page is never
  // lost to an unhandled WebView popup request.
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href]');
    if (!link || !/^https?:/i.test(link.href)) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey || link.target === '_blank') window.open(link.href, '_blank');
    else location.href = link.href;
  }, true);
  const hide = () => { menu.style.display = 'none'; };
  const copyText = async (value) => {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return; }
    } catch (_) {}
    const helper = document.createElement('textarea');
    helper.value = value;
    Object.assign(helper.style, { position:'fixed', left:'-9999px', top:'-9999px', opacity:'0' });
    document.body.appendChild(helper);
    helper.focus(); helper.select();
    try { document.execCommand('copy'); } finally { helper.remove(); }
  };
  document.addEventListener('mousedown', (event) => { if (event.button !== 2) hide(); });
  document.addEventListener('contextmenu', (event) => {
    if (suppressMenu) { suppressMenu = false; event.preventDefault(); return; }
    event.preventDefault();
    menu.style.left = Math.min(event.clientX, innerWidth - 165) + 'px';
    menu.style.top = Math.min(event.clientY, innerHeight - 220) + 'px';
    menu.style.display = 'block';
    menu.dataset.href = event.target.closest?.('a')?.href || location.href;
  }, true);
  menu.addEventListener('click', async (event) => {
    const action = event.target.closest?.('[data-action]')?.dataset.action;
    if (!action) return;
    hide();
    if (action === 'back') history.back();
    if (action === 'forward') history.forward();
    if (action === 'reload') location.reload();
    if (action === 'open' && /^https?:/i.test(menu.dataset.href || '')) location.href = menu.dataset.href;
    if (action === 'open-tab' && /^https?:/i.test(menu.dataset.href || '')) window.open(menu.dataset.href, '_blank');
    if (action === 'print') print();
    if (action === 'copy') await copyText(menu.dataset.href || location.href);
  });
  document.addEventListener('mousedown', (event) => { if (event.button === 2) rightDown = { x:event.clientX, y:event.clientY }; }, true);
  document.addEventListener('mouseup', (event) => {
    if (event.button !== 2 || !rightDown) return;
    const dx = event.clientX - rightDown.x;
    rightDown = null;
    if (Math.abs(dx) < 70) return;
    suppressMenu = true;
    if (dx > 0) history.back(); else history.forward();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); history.back(); return; }
    if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); history.forward(); return; }
    if (event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r')) { event.preventDefault(); location.reload(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); print(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      let findBar = document.getElementById('__mynx_find_bar');
      if (!findBar) {
        findBar = document.createElement('div');
        findBar.id = '__mynx_find_bar';
        findBar.innerHTML = `<input aria-label="${copy.find}" placeholder="${copy.find}"><span></span><button aria-label="${copy.closeFind}">×</button>`;
        Object.assign(findBar.style, { position:'fixed', top:'16px', right:'22px', zIndex:'2147483646', display:'flex', alignItems:'center', gap:'8px', padding:'7px 8px 7px 11px', background:'#fff', color:'#17212f', border:'1px solid #dce2e9', borderRadius:'10px', boxShadow:'0 10px 28px rgba(27,39,56,.2)', font:'13px Segoe UI, sans-serif' });
        const input = findBar.querySelector('input');
        Object.assign(input.style, { width:'190px', border:0, outline:0, color:'inherit', font:'inherit' });
        Object.assign(findBar.querySelector('span').style, { minWidth:'34px', color:'#748196', fontSize:'11px' });
        Object.assign(findBar.querySelector('button').style, { width:'24px', height:'24px', border:0, borderRadius:'6px', background:'transparent', color:'#748196', cursor:'pointer', fontSize:'18px' });
        document.documentElement.appendChild(findBar);
        const update = () => { const value = input.value; findBar.querySelector('span').textContent = value && window.find ? (window.find(value) ? copy.found : copy.notFound) : ''; };
        input.addEventListener('input', update);
        input.addEventListener('keydown', (findEvent) => { if (findEvent.key === 'Enter') { findEvent.preventDefault(); update(); } });
        findBar.querySelector('button').addEventListener('click', () => findBar.remove());
      }
      const input = findBar.querySelector('input'); input.focus(); input.select();
      return;
    }
    if (event.key === 'Escape') {
      const findBar = document.getElementById('__mynx_find_bar');
      if (findBar) { findBar.remove(); return; }
      window.stop();
      return;
    }
    if (!(event.ctrlKey || event.metaKey)) return;
  }, true);
})();
"#;

/// Convert any `io::Error` into our unified `CommandError`.
fn io_err(e: std::io::Error) -> CommandError {
    CommandError::Io(e.to_string())
}

/// Returns the path to the current executable.
///
/// Async so it never blocks the Tauri main thread; resolves the path on the
/// Tokio runtime. Errors are returned as `Result` rather than panicking.
#[tauri::command]
async fn app_exe_path() -> Result<String, CommandError> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| CommandError::ExePath(e.to_string()))
}

/// Checks if the app is running from a portable location (not in Program Files).
/// Kept for compat, always returns false for installed-only builds.
#[tauri::command]
async fn is_portable() -> Result<bool, CommandError> {
    Ok(false)
}

/// Clean up leftover .bak file from a previous portable self-update.
/// Kept for compat in case a user upgrades from an older portable version.
///
/// Uses `tokio::fs` so the (rare) blocking file removal never stalls the
/// command thread pool.
#[tauri::command]
async fn cleanup_update_bak() -> Result<(), CommandError> {
    let current: PathBuf =
        std::env::current_exe().map_err(|e| CommandError::ExePath(e.to_string()))?;

    #[cfg(windows)]
    let bak_path = current.with_extension("exe.bak");
    #[cfg(not(windows))]
    let bak_path = current.with_extension("bak");

    if bak_path.exists() {
        // Best-effort removal; an error here is non-fatal but we still surface
        // it to the caller instead of silently swallowing it.
        tokio::fs::remove_file(&bak_path).await.map_err(io_err)?;
    }
    Ok(())
}

fn search_url(engine: &str, query: &str) -> Result<Url, CommandError> {
    let base = match engine {
        "google" => "https://www.google.com/search?igu=1&hl=zh-CN&q=",
        "bing" => "https://www.bing.com/search?q=",
        "baidu" => "https://www.baidu.com/s?wd=",
        "brave" => "https://search.brave.com/search?q=",
        "perplexity" => "https://www.perplexity.ai/search/new?q=",
        "you" => "https://you.com/search?q=",
        _ => return Err(CommandError::Search("不支持的搜索引擎".into())),
    };
    let encoded = utf8_percent_encode(query, NON_ALPHANUMERIC).to_string();
    format!("{base}{encoded}")
        .parse()
        .map_err(|error| CommandError::Search(format!("搜索地址无效：{error}")))
}

fn external_url(value: &str) -> Result<Url, CommandError> {
    let parsed = value
        .parse::<Url>()
        .map_err(|error| CommandError::Search(format!("网页地址无效：{error}")))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        _ => Err(CommandError::Search("只支持打开 http 或 https 网页".into())),
    }
}

fn search_tab_label(tab: u32) -> String {
    if tab == 0 {
        "mynx-search-content".into()
    } else {
        format!("mynx-search-tab-{tab}")
    }
}

fn search_tab_id(label: &str) -> Option<u32> {
    if label == "mynx-search-content" {
        Some(0)
    } else {
        label.strip_prefix("mynx-search-tab-")?.parse().ok()
    }
}

fn hide_search_tabs(app: &AppHandle) {
    for webview in app.webviews().into_values() {
        if search_tab_id(webview.label()).is_some() {
            let _ = webview.hide();
        }
    }
}

fn search_home_url(engine: &str) -> Result<Url, CommandError> {
    let value = match engine {
        "google" => "https://www.google.com/",
        "bing" => "https://www.bing.com/",
        "baidu" => "https://www.baidu.com/",
        "brave" => "https://search.brave.com/",
        "perplexity" => "https://www.perplexity.ai/",
        "you" => "https://you.com/",
        _ => return Err(CommandError::Search("不支持的搜索引擎".into())),
    };
    external_url(value)
}

fn layout_search_tab(window: &tauri::Window, webview: &tauri::Webview) {
    if let Ok(size) = window.inner_size() {
        let _ = webview.set_position(PhysicalPosition::new(0, SEARCH_TOOLBAR_HEIGHT));
        let _ = webview.set_size(PhysicalSize::new(
            size.width,
            size.height.saturating_sub(SEARCH_TOOLBAR_HEIGHT),
        ));
    }
}

fn next_search_tab_id(app: &AppHandle) -> u32 {
    app.webviews()
        .into_values()
        .filter_map(|webview| search_tab_id(webview.label()))
        .max()
        .unwrap_or(0)
        .saturating_add(1)
}

fn update_search_zoom(webview: &tauri::Webview, action: &str) -> Result<(), CommandError> {
    let zooms = SEARCH_ZOOMS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut zooms = zooms
        .lock()
        .map_err(|_| CommandError::Builder("页面缩放状态不可用".into()))?;
    let current = *zooms.entry(webview.label().to_string()).or_insert(1.0);
    let next = match action {
        "zoom-in" => (current + 0.1).min(5.0),
        "zoom-out" => (current - 0.1).max(0.2),
        "zoom-reset" => 1.0,
        _ => return Err(CommandError::Search("不支持的缩放操作".into())),
    };
    webview
        .set_zoom(next)
        .map_err(|error| CommandError::Builder(error.to_string()))?;
    zooms.insert(webview.label().to_string(), next);
    Ok(())
}

fn build_search_content_webview(
    app: AppHandle,
    window: tauri::Window,
    label: String,
    url: Url,
) -> WebviewBuilder<tauri::Wry> {
    let webview_label = label.clone();
    WebviewBuilder::new(label, WebviewUrl::External(url))
        .initialization_script(SEARCH_CONTENT_SCRIPT)
        .zoom_hotkeys_enabled(true)
        .on_navigation({
            let app = app.clone();
            let webview_label = webview_label.clone();
            move |url| {
                if matches!(url.scheme(), "http" | "https") {
                    let _ = app.emit(
                        "search-tab-url",
                        serde_json::json!({ "id": search_tab_id(&webview_label), "url": url.as_str() }),
                    );
                }
                true
            }
        })
        .on_new_window({
            let app = app.clone();
            let window = window.clone();
            move |url, _| {
                if !matches!(url.scheme(), "http" | "https") {
                    return NewWindowResponse::Deny;
                }
                let next_id = next_search_tab_id(&app);
                let label = search_tab_label(next_id);
                hide_search_tabs(&app);
                let builder = build_search_content_webview(
                    app.clone(),
                    window.clone(),
                    label,
                    url,
                );
                if let Ok(webview) = window.add_child(
                    builder,
                    PhysicalPosition::new(0, SEARCH_TOOLBAR_HEIGHT),
                    PhysicalSize::new(1, 1),
                ) {
                    layout_search_tab(&window, &webview);
                    let _ = webview.show();
                    let _ = window.emit(
                        "search-tab-created",
                        serde_json::json!({ "id": next_id, "query": "", "engine": "bing" }),
                    );
                }
                NewWindowResponse::Deny
            }
        })
        .on_page_load({
            let app = app.clone();
            move |webview, payload| {
                let state = match payload.event() {
                    PageLoadEvent::Started => "started",
                    PageLoadEvent::Finished => "finished",
                };
                let _ = app.emit(
                    "search-page-load",
                    serde_json::json!({ "state": state, "tab": search_tab_id(webview.label()) }),
                );
            }
        })
        .on_document_title_changed({
            let app = app.clone();
            move |webview, title| {
                let _ = app.emit(
                    "search-tab-title",
                    serde_json::json!({ "id": search_tab_id(webview.label()), "title": title }),
                );
            }
        })
}

#[tauri::command]
async fn open_search_window(
    app: AppHandle,
    engine: String,
    query: String,
    tab: Option<u32>,
) -> Result<(), CommandError> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 200 {
        return Err(CommandError::Search("搜索内容需为 1-200 个字符".into()));
    }
    let parsed_url = search_url(&engine, query)?;
    let label = "mynx-search";

    let active_tab = tab.unwrap_or(0);
    if let Some(window) = app.get_window(label) {
        if let Some(content) = app.get_webview(&search_tab_label(active_tab)) {
            hide_search_tabs(&app);
            content
                .show()
                .map_err(|error| CommandError::Builder(error.to_string()))?;
            content
                .navigate(parsed_url)
                .map_err(|error| CommandError::Builder(error.to_string()))?;
            window
                .emit(
                    "search-query",
                    serde_json::json!({ "engine": engine, "query": query, "tab": active_tab }),
                )
                .map_err(|error| CommandError::Builder(error.to_string()))?;
            window
                .set_focus()
                .map_err(|error| CommandError::Builder(error.to_string()))?;
            return Ok(());
        }
        window
            .set_focus()
            .map_err(|error| CommandError::Builder(error.to_string()))?;
    }

    let window = WindowBuilder::new(&app, label)
        .title("Mynx 搜索")
        .inner_size(1100.0, 760.0)
        .min_inner_size(640.0, 480.0)
        .resizable(true)
        .decorations(false)
        .visible(false)
        .background_color(tauri::window::Color(244, 246, 249, 255))
        .build()
        .map_err(|error| CommandError::Builder(error.to_string()))?;
    let toolbar_engine = utf8_percent_encode(&engine, NON_ALPHANUMERIC).to_string();
    let toolbar_query = utf8_percent_encode(query, NON_ALPHANUMERIC).to_string();
    let size = window
        .inner_size()
        .map_err(|error| CommandError::Builder(error.to_string()))?;
    let toolbar = window
        .add_child(
            WebviewBuilder::new(
                "mynx-search-toolbar",
                WebviewUrl::App(
                    format!("index.html#/search-window?engine={toolbar_engine}&query={toolbar_query}")
                        .into(),
                ),
            ),
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(size.width, SEARCH_TOOLBAR_HEIGHT),
        )
        .map_err(|error| CommandError::Builder(error.to_string()))?;
    let _content = window
        .add_child(
            build_search_content_webview(
                app.clone(),
                window.clone(),
                "mynx-search-content".into(),
                parsed_url,
            ),
            PhysicalPosition::new(0, SEARCH_TOOLBAR_HEIGHT),
            PhysicalSize::new(size.width, size.height.saturating_sub(SEARCH_TOOLBAR_HEIGHT)),
        )
        .map_err(|error| CommandError::Builder(error.to_string()))?;
    let toolbar = toolbar.clone();
    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Resized(size) = event {
            let _ = toolbar.set_size(PhysicalSize::new(size.width, SEARCH_TOOLBAR_HEIGHT));
            for webview in app_handle.webviews().into_values() {
                if search_tab_id(webview.label()).is_some() {
                    let _ = webview.set_position(PhysicalPosition::new(0, SEARCH_TOOLBAR_HEIGHT));
                    let _ = webview.set_size(PhysicalSize::new(
                        size.width,
                        size.height.saturating_sub(SEARCH_TOOLBAR_HEIGHT),
                    ));
                }
            }
        }
    });
    window
        .show()
        .map_err(|error| CommandError::Builder(error.to_string()))?;
    window
        .set_focus()
        .map_err(|error| CommandError::Builder(error.to_string()))?;
    Ok(())
}

#[tauri::command]
async fn search_new_tab(app: AppHandle, engine: String, query: String) -> Result<u32, CommandError> {
    let window = app
        .get_window("mynx-search")
        .ok_or_else(|| CommandError::Builder("搜索窗口尚未打开".into()))?;
    let url = if query.trim().is_empty() {
        search_home_url(&engine)?
    } else {
        search_url(&engine, query.trim())?
    };
    let next_id = next_search_tab_id(&app);
    let label = search_tab_label(next_id);
    if app.get_webview(&label).is_some() {
        return Err(CommandError::Builder("标签页标识已被占用".into()));
    }
    hide_search_tabs(&app);
    let webview = window
        .add_child(
            build_search_content_webview(app.clone(), window.clone(), label.clone(), url),
            PhysicalPosition::new(0, SEARCH_TOOLBAR_HEIGHT),
            PhysicalSize::new(1, 1),
        )
        .map_err(|error| CommandError::Builder(error.to_string()))?;
    layout_search_tab(&window, &webview);
    webview
        .show()
        .map_err(|error| CommandError::Builder(error.to_string()))?;
    window
        .emit(
            "search-tab-created",
            serde_json::json!({ "id": next_id, "query": query.trim(), "engine": engine }),
        )
        .map_err(|error| CommandError::Builder(error.to_string()))?;
    Ok(next_id)
}

#[tauri::command]
async fn search_switch_tab(app: AppHandle, tab: u32) -> Result<(), CommandError> {
    let label = search_tab_label(tab);
    let target = app
        .get_webview(&label)
        .ok_or_else(|| CommandError::Builder("标签页不存在".into()))?;
    hide_search_tabs(&app);
    target
        .show()
        .map_err(|error| CommandError::Builder(error.to_string()))?;
    if let Some(window) = app.get_window("mynx-search") {
        window
            .emit("search-tab-switched", serde_json::json!({ "id": tab }))
            .map_err(|error| CommandError::Builder(error.to_string()))?;
        window
            .set_focus()
            .map_err(|error| CommandError::Builder(error.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
async fn search_close_tab(
    app: AppHandle,
    tab: u32,
    query: Option<String>,
    engine: Option<String>,
) -> Result<(), CommandError> {
    let label = search_tab_label(tab);
    let target = app
        .get_webview(&label)
        .ok_or_else(|| CommandError::Builder("标签页不存在".into()))?;
    let fallback_tab = app
        .webviews()
        .into_values()
        .filter_map(|webview| search_tab_id(webview.label()))
        .filter(|id| *id != tab)
        .min();
    let fallback_tab = fallback_tab.ok_or_else(|| CommandError::Search("至少需要保留一个标签页".into()))?;
    target
        .close()
        .map_err(|error| CommandError::Builder(error.to_string()))?;
    let fallback = app
        .get_webview(&search_tab_label(fallback_tab))
        .ok_or_else(|| CommandError::Builder("默认标签页不存在".into()))?;
    hide_search_tabs(&app);
    fallback
        .show()
        .map_err(|error| CommandError::Builder(error.to_string()))?;
    if let Some(window) = app.get_window("mynx-search") {
        window
            .emit(
                "search-tab-closed",
                serde_json::json!({
                    "id": tab,
                    "active": fallback_tab,
                    "query": query.unwrap_or_default(),
                    "engine": engine.unwrap_or_else(|| "bing".into()),
                }),
            )
            .map_err(|error| CommandError::Builder(error.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
async fn navigate_search_window(app: AppHandle, url: String, tab: Option<u32>) -> Result<(), CommandError> {
    let parsed_url = external_url(url.trim())?;
    let content = app
        .get_webview(&search_tab_label(tab.unwrap_or(0)))
        .ok_or_else(|| CommandError::Builder("搜索页面尚未打开".into()))?;
    content
        .navigate(parsed_url)
        .map_err(|error| CommandError::Builder(error.to_string()))?;
    if let Some(window) = app.get_window("mynx-search") {
        window
            .set_focus()
            .map_err(|error| CommandError::Builder(error.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
async fn search_content_action(app: AppHandle, action: String, tab: Option<u32>) -> Result<(), CommandError> {
    let content = app
        .get_webview(&search_tab_label(tab.unwrap_or(0)))
        .ok_or_else(|| CommandError::Builder("搜索页面尚未打开".into()))?;
    if matches!(action.as_str(), "zoom-in" | "zoom-out" | "zoom-reset") {
        return update_search_zoom(&content, &action);
    }
    if action == "print" {
        return content
            .print()
            .map_err(|error| CommandError::Builder(error.to_string()));
    }
    let script = match action.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        _ => return Err(CommandError::Search("不支持的浏览器操作".into())),
    };
    content
        .eval(script)
        .map_err(|error| CommandError::Builder(error.to_string()))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
struct IpWhoLocation {
    success: bool,
    latitude: Option<f64>,
    longitude: Option<f64>,
    city: Option<String>,
    region: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenMeteoResponse {
    current: Option<OpenMeteoCurrent>,
}

#[derive(Debug, Deserialize)]
struct OpenMeteoCurrent {
    temperature_2m: f64,
    relative_humidity_2m: f64,
    weather_code: i32,
    wind_speed_10m: f64,
    is_day: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WeatherResult {
    temperature: i32,
    weather_code: i32,
    humidity: i32,
    wind_speed: i32,
    city: String,
    is_day: bool,
}

#[tauri::command]
async fn weather_by_ip() -> Result<WeatherResult, CommandError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Mynx/2.2")
        .build()
        .map_err(|e| CommandError::Network(e.to_string()))?;
    let location: IpWhoLocation = client
        .get("https://ipwho.is/")
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|e| CommandError::Network(format!("Location service: {e}")))?
        .json()
        .await
        .map_err(|e| CommandError::Network(format!("Invalid location response: {e}")))?;
    if !location.success {
        return Err(CommandError::Network(
            "Location service returned no location".into(),
        ));
    }
    let lat = location
        .latitude
        .ok_or_else(|| CommandError::Network("Missing latitude".into()))?;
    let lon = location
        .longitude
        .ok_or_else(|| CommandError::Network("Missing longitude".into()))?;
    let city = match (location.city, location.region) {
        (Some(city), Some(region)) if city != region => format!("{city} · {region}"),
        (Some(city), _) => city,
        (_, Some(region)) => region,
        _ => "当前位置".into(),
    };
    let weather_url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day&timezone=auto"
    );
    let weather: OpenMeteoResponse = client
        .get(weather_url)
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|e| CommandError::Network(format!("Weather service: {e}")))?
        .json()
        .await
        .map_err(|e| CommandError::Network(format!("Invalid weather response: {e}")))?;
    let current = weather
        .current
        .ok_or_else(|| CommandError::Network("Weather data unavailable".into()))?;
    Ok(WeatherResult {
        temperature: current.temperature_2m.round() as i32,
        weather_code: current.weather_code,
        humidity: current.relative_humidity_2m.round() as i32,
        wind_speed: current.wind_speed_10m.round() as i32,
        city,
        is_day: current.is_day == 1,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            app_exe_path,
            is_portable,
            cleanup_update_bak,
            open_search_window,
            search_new_tab,
            search_switch_tab,
            search_close_tab,
            navigate_search_window,
            search_content_action,
            weather_by_ip
        ])
        .setup(|app| {
            // No shared state is currently needed (commands are stateless),
            // but if future commands require managed state it must be added
            // here as `Arc<Mutex<T>>` (use `tokio::sync::Mutex` for async
            // commands) and injected via `app.manage(...)`.
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .map_err(|e| CommandError::Builder(e.to_string()))
        // The builder's `run` is the top-level entry point and must own the
        // process. We cannot return a `Result` here, so we fall back to
        // printing the error and exiting instead of `expect()`-ing — which
        // would panic with an opaque message on production builds.
        .unwrap_or_else(|e| {
            eprintln!("[mynx] fatal: {e}");
            std::process::exit(1);
        });
}
