//! Office COM Automation for inserting docx content into Word/WPS
//!
//! This module provides COM automation functionality to insert docx file contents
//! directly into running Word or WPS applications at the cursor position.
//!
//! Implementation: Uses embedded PowerShell script to perform COM automation,
//! avoiding complex windows-rs COM bindings.

use std::path::Path;
use std::process::Command;
use log::{error, info, warn};

/// PowerShell script for Office COM automation
const PS_SCRIPT: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/scripts/insert_to_office.ps1"));

/// Check if the foreground window is a Word or WPS document window
#[cfg(windows)]
pub fn is_foreground_word_or_wps() -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW,
        PROCESS_QUERY_INFORMATION, PROCESS_NAME_WIN32,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return false;
        }

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));

        // Get process name
        let process_name = {
            let handle = match OpenProcess(PROCESS_QUERY_INFORMATION, false, pid) {
                Ok(h) => h,
                Err(_) => return false,
            };

            let mut buffer = [0u16; 512];
            let mut size = buffer.len() as u32;

            let result = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buffer.as_mut_ptr()),
                &mut size,
            );

            let _ = CloseHandle(handle);

            if result.is_ok() {
                let path = String::from_utf16_lossy(&buffer[..size as usize]);
                path.split('\\')
                    .last()
                    .unwrap_or("")
                    .to_uppercase()
            } else {
                String::new()
            }
        };

        matches!(
            process_name.as_str(),
            "WINWORD.EXE" | "WPS.EXE" | "WPP.EXE" | "ET.EXE" | "KWPS.EXE"
        )
    }
}

#[cfg(not(windows))]
pub fn is_foreground_word_or_wps() -> bool {
    false
}

/// Insert a docx file into the active Word or WPS document at cursor position
/// Uses embedded PowerShell script for COM automation
pub fn insert_docx_into_office<P: AsRef<Path>>(file_path: P) -> anyhow::Result<String> {
    let file_path = file_path.as_ref();

    // Check if foreground window is Word or WPS
    if !is_foreground_word_or_wps() {
        info!("Target is not Word or WPS, using clipboard fallback");
        return Ok("Target is not Word or WPS, using clipboard fallback".to_string());
    }

    // Write PowerShell script to temp file
    let temp_dir = std::env::temp_dir();
    let script_path = temp_dir.join("snipjet_insert_to_office.ps1");

    std::fs::write(&script_path, PS_SCRIPT)
        .map_err(|e| anyhow::anyhow!("Failed to write PowerShell script: {}", e))?;

    // Call PowerShell script to insert the file
    let output = Command::new("powershell.exe")
        .args(&[
            "-ExecutionPolicy", "Bypass",
            "-NoProfile",
            "-File", script_path.to_str().unwrap_or(""),
            "-FilePath", file_path.to_str().unwrap_or(""),
        ])
        .output();

    // Clean up temp script (ignore errors)
    let _ = std::fs::remove_file(&script_path);

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            let stderr = String::from_utf8_lossy(&result.stderr);

            info!("PowerShell stdout: {}", stdout.trim());
            if !stderr.is_empty() {
                warn!("PowerShell stderr: {}", stderr.trim());
            }

            if result.status.success() && stdout.contains("SUCCESS") {
                info!("Content inserted into Office application successfully");
                Ok("Content inserted successfully".to_string())
            } else {
                let error_msg = if stdout.contains("ERROR:") {
                    stdout.trim().to_string()
                } else if !stderr.is_empty() {
                    format!("PowerShell error: {}", stderr.trim())
                } else {
                    "Office automation failed".to_string()
                };
                error!("Office automation failed: {}", error_msg);
                Err(anyhow::anyhow!(error_msg))
            }
        }
        Err(e) => {
            error!("Failed to execute PowerShell: {}", e);
            Err(anyhow::anyhow!("Failed to execute PowerShell: {}", e))
        }
    }
}

/// Check if COM automation is available (Windows only)
pub fn is_com_automation_available() -> bool {
    cfg!(windows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_com_automation_available() {
        let available = is_com_automation_available();
        #[cfg(windows)]
        assert!(available);
        #[cfg(not(windows))]
        assert!(!available);
    }

    #[test]
    fn test_ps_script_embedded() {
        // Verify the PowerShell script is embedded
        assert!(!PS_SCRIPT.is_empty());
        assert!(PS_SCRIPT.contains("InsertFile"));
    }
}
