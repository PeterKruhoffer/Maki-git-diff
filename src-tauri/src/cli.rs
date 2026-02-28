use std::path::PathBuf;

use anyhow::{bail, Context, Result};

pub enum AppMode {
    Gui,
    Review {
        input_path: PathBuf,
        output_path: PathBuf,
    },
}

pub struct CliOptions {
    pub mode: AppMode,
    pub log_level: Option<String>,
    pub use_stdio: bool,
}

pub fn parse_args() -> Result<CliOptions> {
    let mut args = std::env::args().skip(1).peekable();
    let mut review_input: Option<PathBuf> = None;
    let mut review_output: Option<PathBuf> = None;
    let mut log_level: Option<String> = None;
    let mut use_stdio = false;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--review" => {
                let input = args.next().context("Missing <input.json> after --review")?;
                let output = args
                    .next()
                    .context("Missing <output.json> after --review")?;
                review_input = Some(PathBuf::from(input));
                review_output = Some(PathBuf::from(output));
            }
            "--stdio" => {
                use_stdio = true;
            }
            "--log-level" => {
                let value = args.next().context("Missing value after --log-level")?;
                log_level = Some(value);
            }
            unknown => {
                bail!("Unknown argument: {unknown}");
            }
        }
    }

    let mode = match (review_input, review_output) {
        (Some(input_path), Some(output_path)) => AppMode::Review {
            input_path,
            output_path,
        },
        (None, None) => AppMode::Gui,
        _ => bail!("--review requires both <input.json> and <output.json>"),
    };

    Ok(CliOptions {
        mode,
        log_level,
        use_stdio,
    })
}
