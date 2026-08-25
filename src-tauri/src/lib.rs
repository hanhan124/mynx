use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tauri;
use thiserror::Error;

/// Unified, serializable error type for all Tauri commands.
///
/// `thiserror` derives `Display` (used by `Debug` in the default error trace)
/// and `serde` makes it cross the IPC boundary as a structured string the
/// frontend can read via the rejected `Promise` message — replacing every
/// ad-hoc `.unwrap()` / `.expect()` / `e.to_string()` pattern.
#[derive(Debug, Error)]
pub enum CommandError {
    /// Failed to resolve the current executable path.
    #[error("Failed to resolve executable path: {0}")]
    ExePath(String),

    /// A filesystem operation failed (creating/removing the .bak file, etc.).
    #[error("Filesystem error: {0}")]
    Io(String),

    /// The builder failed to start the application.
    #[error("Failed to run Tauri application: {0}")]
    Builder(String),

    #[error("Network request failed: {0}")]
    Network(String),

    #[error("Search response could not be parsed: {0}")]
    Search(String),
}

// Tauri v2 requires command error types to be `Serialize` so they can be sent
// back to the frontend over IPC. `thiserror` already gives us `Display`;
// serde then serializes the `Display` string as the error payload.
impl serde::Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.to_string().as_ref())
    }
}

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebSearchResult {
    title: String,
    url: String,
    description: String,
}

fn strip_html(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut inside_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => output.push(ch),
            _ => {}
        }
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[tauri::command]
async fn web_search(query: String) -> Result<Vec<WebSearchResult>, CommandError> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 200 {
        return Err(CommandError::Search(
            "Search text must contain 1-200 characters".into(),
        ));
    }

    let encoded = utf8_percent_encode(query, NON_ALPHANUMERIC).to_string();
    let url = format!("https://www.bing.com/search?format=rss&setlang=zh-hans&q={encoded}");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("Mozilla/5.0 Mynx/2.2")
        .build()
        .map_err(|e| CommandError::Network(e.to_string()))?;
    let xml = client
        .get(url)
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|e| CommandError::Network(e.to_string()))?
        .text()
        .await
        .map_err(|e| CommandError::Network(e.to_string()))?;

    let mut reader = Reader::from_str(&xml);
    reader.config_mut().trim_text(true);
    let mut results = Vec::new();
    let mut in_item = false;
    let mut field = String::new();
    let mut title = String::new();
    let mut link = String::new();
    let mut description = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                let name = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                if name == "item" {
                    in_item = true;
                    title.clear();
                    link.clear();
                    description.clear();
                } else if in_item {
                    field = name;
                }
            }
            Ok(Event::Text(text)) if in_item => {
                let value = text
                    .decode()
                    .map_err(|e| CommandError::Search(e.to_string()))?;
                match field.as_str() {
                    "title" => title.push_str(&value),
                    "link" => link.push_str(&value),
                    "description" => description.push_str(&value),
                    _ => {}
                }
            }
            Ok(Event::CData(text)) if in_item => {
                let value = text
                    .decode()
                    .map_err(|e| CommandError::Search(e.to_string()))?;
                if field == "description" {
                    description.push_str(&value);
                }
            }
            Ok(Event::End(event)) => {
                let name = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                if name == "item" {
                    in_item = false;
                    if !title.is_empty()
                        && (link.starts_with("https://") || link.starts_with("http://"))
                    {
                        results.push(WebSearchResult {
                            title: title.clone(),
                            url: link.clone(),
                            description: strip_html(&description),
                        });
                    }
                    if results.len() >= 12 {
                        break;
                    }
                }
                field.clear();
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(CommandError::Search(error.to_string())),
            _ => {}
        }
    }

    Ok(results)
}

#[derive(Debug, Serialize)]
struct GeminiCitation {
    title: String,
    url: String,
}

#[derive(Debug, Serialize)]
struct GeminiSearchResult {
    text: String,
    citations: Vec<GeminiCitation>,
}

#[tauri::command]
async fn ai_search(api_key: String, query: String) -> Result<GeminiSearchResult, CommandError> {
    let api_key = api_key.trim();
    let query = query.trim();
    if api_key.len() < 20 {
        return Err(CommandError::Network(
            "AI 搜索 API Key 未配置或格式不正确".into(),
        ));
    }
    let sources = web_search(query.to_string()).await?;
    if sources.is_empty() {
        return Err(CommandError::Search(
            "没有找到可供 AI 整理的网页结果".into(),
        ));
    }
    let context = sources
        .iter()
        .enumerate()
        .map(|(index, item)| {
            format!(
                "{}. {}\n摘要：{}\n链接：{}",
                index + 1,
                item.title,
                item.description,
                item.url
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let body = serde_json::json!({
        "model": "openrouter/free",
        "messages": [
            { "role": "system", "content": "你是一个中文网页搜索摘要助手。只能根据提供的搜索结果回答，不要编造事实。请严格使用 Markdown：用合适的标题、段落和 3-5 条列表组织内容；需要强调时使用粗体。" },
            { "role": "user", "content": format!("问题：{query}\n\n搜索结果：\n{context}") }
        ],
        "temperature": 0.2,
        "max_tokens": 1000
    });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Mynx/2.2")
        .build()
        .map_err(|e| CommandError::Network(e.to_string()))?;
    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .bearer_auth(api_key)
        .header("HTTP-Referer", "https://github.com/hanhan124/mynx")
        .header("X-OpenRouter-Title", "Mynx")
        .json(&body)
        .send()
        .await
        .map_err(|e| CommandError::Network(format!("AI 搜索请求失败：{e}")))?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| CommandError::Network(format!("AI 响应无法解析：{e}")))?;
    if !status.is_success() {
        let message = payload
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("AI 服务暂时不可用");
        return Err(CommandError::Network(message.to_string()));
    }
    let text = payload
        .get("choices")
        .and_then(|items| items.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CommandError::Search("AI 没有返回可用内容".into()))?
        .to_string();
    let citations = sources
        .into_iter()
        .map(|source| GeminiCitation {
            title: source.title,
            url: source.url,
        })
        .collect();
    Ok(GeminiSearchResult { text, citations })
}

#[tauri::command]
async fn gemini_search(api_key: String, query: String) -> Result<GeminiSearchResult, CommandError> {
    let api_key = api_key.trim();
    let query = query.trim();
    if api_key.len() < 20 {
        return Err(CommandError::Network(
            "Gemini API Key 未配置或格式不正确".into(),
        ));
    }
    if query.is_empty() || query.chars().count() > 200 {
        return Err(CommandError::Search("搜索内容需为 1-200 个字符".into()));
    }
    let endpoint = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    );
    let prompt = format!(
        "请用中文回答用户的网页搜索问题：{query}\n\n要求：先给出简洁结论，再用 3-5 条要点补充。只陈述搜索结果能支持的事实，并在回答末尾提醒信息可能随时间变化。"
    );
    let body = serde_json::json!({
        "contents": [{ "role": "user", "parts": [{ "text": prompt }] }],
        "tools": [{ "google_search": {} }],
        "generationConfig": { "temperature": 0.2, "maxOutputTokens": 1200 }
    });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Mynx/2.2")
        .build()
        .map_err(|e| CommandError::Network(e.to_string()))?;
    let response = client
        .post(endpoint)
        .json(&body)
        .send()
        .await
        .map_err(|e| CommandError::Network(format!("Gemini 请求失败：{e}")))?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| CommandError::Network(format!("Gemini 响应无法解析：{e}")))?;
    if !status.is_success() {
        let message = payload
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("Gemini 服务暂时不可用");
        return Err(CommandError::Network(message.to_string()));
    }
    let text = payload
        .get("candidates")
        .and_then(|items| items.get(0))
        .and_then(|candidate| candidate.get("content"))
        .and_then(|content| content.get("parts"))
        .and_then(|parts| parts.as_array())
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| part.get("text").and_then(serde_json::Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CommandError::Search("Gemini 没有返回可用内容".into()))?;
    let citations = payload
        .get("candidates")
        .and_then(|items| items.get(0))
        .and_then(|candidate| candidate.get("groundingMetadata"))
        .and_then(|metadata| metadata.get("groundingChunks"))
        .and_then(serde_json::Value::as_array)
        .map(|chunks| {
            chunks
                .iter()
                .filter_map(|chunk| chunk.get("web"))
                .filter_map(|web| {
                    let url = web.get("uri")?.as_str()?.to_string();
                    let title = web
                        .get("title")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("来源网页")
                        .to_string();
                    Some(GeminiCitation { title, url })
                })
                .take(8)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(GeminiSearchResult { text, citations })
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
            web_search,
            ai_search,
            gemini_search,
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
