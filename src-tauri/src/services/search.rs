use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use tauri::Url;

use crate::error::CommandError;

pub(crate) fn search_url(engine: &str, query: &str) -> Result<Url, CommandError> {
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

pub(crate) fn external_url(value: &str) -> Result<Url, CommandError> {
    let parsed = value
        .parse::<Url>()
        .map_err(|error| CommandError::Search(format!("网页地址无效：{error}")))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        _ => Err(CommandError::Search("只支持打开 http 或 https 网页".into())),
    }
}

pub(crate) fn search_home_url(engine: &str) -> Result<Url, CommandError> {
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
