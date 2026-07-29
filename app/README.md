# Modelica Language

Modelica (`.mo`) files support for Visual Studio Code.

This extension provides syntax highlighting, package navigation, completion, rename, documentation preview, diagram/icon preview, and OpenModelica-backed model check and simulation commands. Language navigation features are implemented with a lightweight resolver, so OpenModelica is required only when running `checkModel` or simulation.

## Features

| Feature | How to use | OpenModelica |
|---|---|---|
| Syntax highlighting | Open a `.mo` file | Not required |
| Package tree | Open the Modelica view in the Activity Bar | Not required |
| Create model/block/package files | Use the `+` button in the Modelica view | Not required |
| Go to definition | `F12` or `Ctrl` + click | Not required |
| Completion | Type `.` or press `Ctrl` + `Space` | Not required |
| Rename local variables/components | `F2` | Not required |
| Documentation preview | `Modelica: Documentation を表示` | Not required |
| Diagram preview | `Modelica: ダイアグラムを表示` | Not required |
| Icon preview | `Modelica: アイコンを表示` | Not required |
| Hide/show annotations | `Modelica: annotation の表示/非表示` | Not required |
| Check model | `Modelica: モデルをチェック (checkModel)` | Required |
| Run simulation | `Modelica: シミュレーション実行 (simulate)` | Required |

## Quick Start

1. Open a folder that contains Modelica packages or `.mo` files.
2. Open the Modelica view from the Activity Bar.
3. Browse packages by Modelica namespace, not just by files and folders.
4. Open a class from the tree, then use the editor title buttons or the command palette for check, simulation, documentation, diagram, and icon views.

The package tree automatically follows file additions, deletions, and edits. It supports structured Modelica libraries with `package.mo` / `package.order` as well as standalone `.mo` files.

## OpenModelica

OpenModelica is required for:

- `checkModel`
- `simulate`

Other editing and navigation features work without OpenModelica.

If `omc` is available in `PATH`, the default setting is enough. Otherwise, set the executable path in:

```json
"modelica.omcPath": "C:\\Program Files\\OpenModelica1.26.1-64bit\\bin\\omc.exe"
```

You can confirm the installation from a terminal:

```sh
omc --version
```

## Settings

| Setting | Default | Description |
|---|---:|---|
| `modelica.omcPath` | `omc` | Path to the OpenModelica compiler executable |
| `modelica.checkOnSave` | `false` | Run `checkModel` automatically on save |
| `modelica.simulation.stopTime` | `1.0` | Default stop time for simulation setup |
| `modelica.simulation.numberOfIntervals` | `500` | Default number of simulation output intervals |
| `modelica.tree.focusDefinition` | `true` | Fold surrounding code when opening a class from the package tree |

## Current Limitations

- Go to definition focuses on fully qualified class references and local variables/components.
- Import aliases, inherited relative names, and workspace-external library paths are not fully resolved yet.
- Rename currently targets variables/components inside the current class. Cross-file class rename is not supported yet.
- Diagram and icon views are read-only previews.

## License

This extension is distributed under the MIT License.

The packaged VSIX includes the repository license file as `LICENSE.txt`.

## Development

The extension source lives under `app/` in the repository.

```sh
npm install
npm run compile
```

For repository-level setup and detailed implementation notes, see the project README.
