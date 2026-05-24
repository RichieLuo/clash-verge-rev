use super::CmdResult;
use crate::config::Config;
use crate::core::autostart;
use crate::{cmd::StringifyErr as _, feat, utils::dirs};
use smartstring::alias::String;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager as _};

/// 打开应用程序所在目录
#[tauri::command]
pub async fn open_app_dir() -> CmdResult<()> {
    let app_dir = dirs::app_home_dir().stringify_err()?;
    open::that(app_dir).stringify_err()
}

/// 打开核心所在目录
#[tauri::command]
pub async fn open_core_dir() -> CmdResult<()> {
    let core_dir = tauri::utils::platform::current_exe().stringify_err()?;
    let core_dir = core_dir.parent().ok_or("failed to get core dir")?;
    open::that(core_dir).stringify_err()
}

/// 打开日志目录
#[tauri::command]
pub async fn open_logs_dir() -> CmdResult<()> {
    let log_dir = dirs::app_logs_dir().stringify_err()?;
    open::that(log_dir).stringify_err()
}

/// 打开网页链接
#[tauri::command]
pub fn open_web_url(url: String) -> CmdResult<()> {
    open::that(url.as_str()).stringify_err()
}

// TODO 后续可以为前端提供接口，当前作为托盘菜单使用
/// 打开 Verge 最新日志
#[tauri::command]
pub async fn open_app_log() -> CmdResult<()> {
    let log_path = dirs::app_latest_log().stringify_err()?;
    #[cfg(target_os = "windows")]
    let log_path = crate::utils::help::snapshot_path(&log_path).stringify_err()?;
    open::that(log_path).stringify_err()
}

// TODO 后续可以为前端提供接口，当前作为托盘菜单使用
/// 打开 Clash 最新日志
#[tauri::command]
pub async fn open_core_log() -> CmdResult<()> {
    let log_path = dirs::clash_latest_log().stringify_err()?;
    #[cfg(target_os = "windows")]
    let log_path = crate::utils::help::snapshot_path(&log_path).stringify_err()?;
    open::that(log_path).stringify_err()
}

/// 打开/关闭开发者工具
#[tauri::command]
pub fn open_devtools(app_handle: AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        if !window.is_devtools_open() {
            window.open_devtools();
        } else {
            window.close_devtools();
        }
    }
}

/// 退出应用
#[tauri::command]
pub async fn exit_app() {
    feat::quit().await;
}

/// 重启应用
#[tauri::command]
pub async fn restart_app() -> CmdResult<()> {
    feat::restart_app().await;
    Ok(())
}

/// 获取便携版标识
#[tauri::command]
pub fn get_portable_flag() -> bool {
    *dirs::PORTABLE_FLAG.get().unwrap_or(&false)
}

/// 获取应用目录
#[tauri::command]
pub fn get_app_dir() -> CmdResult<String> {
    let app_home_dir = dirs::app_home_dir().stringify_err()?.to_string_lossy().into();
    Ok(app_home_dir)
}

/// 获取当前自启动状态
#[tauri::command]
pub fn get_auto_launch_status() -> CmdResult<bool> {
    autostart::get_launch_status().stringify_err()
}

/// 下载图标缓存
#[tauri::command]
pub async fn download_icon_cache(url: String, name: String) -> CmdResult<String> {
    feat::download_icon_cache(url, name).await
}

/// 复制图标文件
#[tauri::command]
pub async fn copy_icon_file(path: String, icon_info: feat::IconInfo) -> CmdResult<String> {
    feat::copy_icon_file(path, icon_info).await
}

/// 使用 Clash 代理环境变量启动应用程序
#[tauri::command]
pub async fn launch_app_with_proxy(
    path: String,
    args: Option<String>,
    app_id: Option<String>,
    app_name: Option<String>,
    isolated_browser: Option<bool>,
) -> CmdResult<u32> {
    let launch_target = resolve_launch_target(Path::new(path.as_str()))?;
    if !launch_target.exists() {
        return Err("Application path does not exist".into());
    }
    if !launch_target.is_file() {
        return Err("Application path is not a file".into());
    }

    let verge_cfg = Config::verge().await.latest_arc();
    let ip = std::env::var("CLASH_VERGE_REV_IP")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| verge_cfg.proxy_host.clone())
        .unwrap_or_else(|| "127.0.0.1".into());
    let mixed_port = verge_cfg.verge_mixed_port.unwrap_or(7897);
    let http_proxy = format!("http://{ip}:{mixed_port}");
    let socks_proxy = format!("socks5://{ip}:{mixed_port}");

    let mut command = Command::new(&launch_target);
    if let Some(parent) = launch_target.parent() {
        command.current_dir(parent);
    }

    if let Some(args) = args
        && !args.trim().is_empty()
    {
        for arg in split_command_args(args.as_str()) {
            command.arg(arg);
        }
    }

    if isolated_browser.unwrap_or(false) {
        let profile_dir = app_proxy_profile_dir(app_id.as_deref(), app_name.as_deref())?;
        command
            .arg(format!("--user-data-dir={}", profile_dir.to_string_lossy()))
            .arg(format!("--proxy-server={http_proxy}"))
            .arg("--no-first-run");
    }

    command
        .env("HTTP_PROXY", &http_proxy)
        .env("HTTPS_PROXY", &http_proxy)
        .env("ALL_PROXY", &socks_proxy)
        .env("http_proxy", &http_proxy)
        .env("https_proxy", &http_proxy)
        .env("all_proxy", &socks_proxy);

    let child = command.spawn().stringify_err()?;
    Ok(child.id())
}

fn resolve_launch_target(path: &Path) -> CmdResult<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        if path.is_dir()
            && path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
        {
            return resolve_macos_app_executable(path);
        }
    }

    Ok(path.to_path_buf())
}

#[cfg(target_os = "macos")]
fn resolve_macos_app_executable(app_path: &Path) -> CmdResult<PathBuf> {
    let macos_dir = app_path.join("Contents").join("MacOS");
    if !macos_dir.is_dir() {
        return Err("Invalid macOS app bundle".into());
    }

    std::fs::read_dir(&macos_dir)
        .stringify_err()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|entry_path| entry_path.is_file())
        .ok_or_else(|| "Failed to find macOS app executable".into())
}

fn app_proxy_profile_dir(app_id: Option<&str>, app_name: Option<&str>) -> CmdResult<PathBuf> {
    let raw = app_id
        .filter(|value| !value.trim().is_empty())
        .or(app_name.filter(|value| !value.trim().is_empty()))
        .unwrap_or("default");
    let safe_name: std::string::String = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let dir = dirs::app_home_dir()
        .stringify_err()?
        .join("app-proxy-profiles")
        .join(safe_name);
    std::fs::create_dir_all(&dir).stringify_err()?;
    Ok(dir)
}

fn split_command_args(args: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = std::string::String::new();
    let mut chars = args.chars().peekable();
    let mut quote: Option<char> = None;
    let mut escaping = false;

    while let Some(ch) = chars.next() {
        if escaping {
            current.push(ch);
            escaping = false;
            continue;
        }

        match ch {
            '\\' if quote == Some('"') => {
                if matches!(chars.peek(), Some('"') | Some('\\')) {
                    escaping = true;
                } else {
                    current.push(ch);
                }
            }
            '"' | '\'' if quote == Some(ch) => quote = None,
            '"' | '\'' if quote.is_none() => quote = Some(ch),
            ch if ch.is_whitespace() && quote.is_none() => {
                if !current.is_empty() {
                    result.push(current.clone().into());
                    current.clear();
                }
            }
            _ => current.push(ch),
        }
    }

    if !current.is_empty() {
        result.push(current.into());
    }

    result
}
