Placeholder installer file (installer.exe)

This repository currently contains a placeholder file named installer.exe at the repository root. It is a text file deliberately named with an .exe extension so it is immediately downloadable from the repository UI. It is NOT a functional installer.

Why a placeholder?
- Building a real Windows installer requires running the project's build process (Tauri + Rust + Node build) on a Windows environment. The repository includes a GitHub Actions workflow (.github/workflows/build-windows.yml) that produces the real installer as an artifact. Use Actions to build and download the real installer.

How to get the real installer (recommended):
1. Open the repository Actions: https://github.com/Allann-as/nexus/actions
2. Select the "Build Windows installer" workflow and run it (or wait for a run triggered by a push to main).
3. After the run completes, download the artifact named tauri-windows-bundle and extract the real installer (.exe or .msi).

If you explicitly want a binary committed into the repo (not recommended), reply here and I can add it — but this will bloat the repository history.
