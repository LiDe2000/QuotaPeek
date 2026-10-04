use super::catalog::{self, Catalog, LIMIT};
use std::{io::Read, path::Path, time::Duration};

pub fn client(destination: &str) -> Result<reqwest::Client, String> {
    let url = reqwest::Url::parse(destination).map_err(|_| "Invalid activity URL.")?;
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30));
    // Loopback configuration and mock APIs must stay on this machine, including
    // when a terminal or system proxy has no localhost bypass configured.
    if matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")) {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|_| "Could not create the activity HTTP client.".into())
}
pub async fn json(mut response: reqwest::Response) -> Result<serde_json::Value, String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read activity response.")?
    {
        if bytes.len() + chunk.len() > LIMIT {
            return Err("Activity response exceeds the size limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Activity response is not valid JSON.".into())
}
pub fn service_url(source: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(source).map_err(|_| "Invalid configuration service URL.")?;
    let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !(url.scheme() == "https" || url.scheme() == "http" && local)
    {
        return Err(
            "Configuration service requires HTTPS (HTTP is allowed only on loopback).".into(),
        );
    }
    Ok(url)
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
    pub catalog: Option<Catalog>,
    pub source: Option<String>,
    pub notice: Option<String>,
    pub session: String,
}
pub async fn load(source: &str, path: &Path) -> Loaded {
    let remote = async {
        if source.is_empty() {
            return Err("No configuration service URL is set.".into());
        }
        let url = service_url(source)?;
        let response = client(url.as_str())?
            .get(url)
            .header("Accept", "application/json")
            .header("Cache-Control", "no-cache")
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map_err(|_| "Configuration service is unreachable.")?;
        if !response.status().is_success() {
            let mut endpoint = response.url().clone();
            endpoint.set_query(None);
            return Err(format!(
                "Configuration service did not return a catalog (HTTP {} from {endpoint}).",
                response.status().as_u16()
            ));
        }
        let value = json(response).await?;
        catalog::parse(&serde_json::to_vec(&value).map_err(|_| "Invalid configuration.")?)
    }
    .await;
    let remote_error = match remote {
        Ok(catalog) => {
            return Loaded {
                catalog: Some(catalog),
                source: Some("server".into()),
                notice: None,
                session: String::new(),
            }
        }
        Err(error) => error,
    };
    let local = (|| {
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .map_err(|_| "Local activities.json is missing or unreadable.")?
            .take((LIMIT + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "Local activities.json is unreadable.")?;
        catalog::parse(&bytes)
    })();
    match local {
        Ok(catalog) => Loaded {
            catalog: Some(catalog),
            source: Some("local".into()),
            notice: Some(if source.is_empty() {
                "Using activities.json beside the application.".into()
            } else {
                format!("{remote_error} Using local activities.json.")
            }),
            session: String::new(),
        },
        Err(error) => Loaded {
            catalog: None,
            source: None,
            notice: Some(format!(
                "Activity configuration is unavailable.\n{remote_error}\n{error}"
            )),
            session: String::new(),
        },
    }
}
