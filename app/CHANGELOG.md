# Changelog

All notable changes to the Modelica Language extension are documented in this file.

## 0.19.0

### Added

- Added Modelica package tree in the Activity Bar.
- Added package/class creation commands from the Modelica tree.
- Added definition navigation for Modelica class references and local variables/components.
- Added completion for packages, classes, component members, keywords, and built-in types.
- Added rename support for variables/components inside the current class.
- Added Documentation preview for `annotation(Documentation(...))`.
- Added read-only Diagram and Icon previews rendered from Modelica annotations.
- Added annotation folding command.
- Added OpenModelica-backed `checkModel` and `simulate` commands.
- Added simulation setup UI and output organization under `.modelica-build/`.

### Notes

- OpenModelica is required only for model checking and simulation.
- Editing, navigation, package tree, documentation, diagram, and icon previews work without OpenModelica.
