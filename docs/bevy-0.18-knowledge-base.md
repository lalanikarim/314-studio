# Bevy 0.18 Documentation – Knowledge Base

## Table of Contents
1. [Overview & Design Goals](#overview)
2. [Quick‑Start Guide](#quickstart)
   - 2.1 [Project Setup (Rust + Cargo)](#project-setup)
   - 2.2 [Configuration Options](#config-options)
   - 2.3 [Optimising Compiles](#optimise-compiles)
   - 2.4 [Fast Build Tips](#fast-build)
3. [ECS Fundamentals](#ecs)
4. [Plugins & the Bevy Ecosystem](#plugins)
5. [Migration Guides (0.18 → later)](#migration)
6. [Official Learning Path (Tutorials / Examples)](#tutorials)
7. [FAQ & Common Issues](#faq)
8. [References (URLs to official docs)](#refs)

---

## 1. Overview & Design Goals <a id="overview"></a>
- **Why Bevy?**  A data‑driven, ECS‑based engine written in Rust that aims to be:
  - **Capable** – full 2D/3D feature set.
  - **Simple** – approachable for newcomers, flexible for power users.
  - **Data‑focused** – ECS, resource system, parallel job queues.
  - **Modular** – use only what you need; replace parts later.
  - **Fast** – low‑latency game loops, parallelised systems.
  - **Productive** – fast incremental compilation.

- **Stability Warning** – Bevy is still in active development (≈ new major version every 3 months). The 0.18 series introduces breaking API changes. Use the provided migration guides; they are the only reliable path.

---

## 2. Quick‑Start Guide <a id="quickstart"></a>
### 2.1 Project Setup (Rust + Cargo) <a id="project-setup"></a>
1. **Install Rust** (stable is enough, nightly gives access to optional fast‑compile features).  
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
2. **Create a new project** and switch into it:
   ```bash
   cargo new my_bevy_game
   cd my_bevy_game
   ```
3. **Add the latest Bevy crate** (at 0.18.x):
   ```bash
   cargo add bevy
   ```
   The generated `Cargo.toml` will contain (example, version may be 0.18.1):
   ```toml
   [dependencies]
   bevy = "0.18.1"
   ```
4. **Create a minimal `src/main.rs`** (exactly the one shipped in the docs):
   ```rust
   fn main() {
       App::new()
           .add_plugins(DefaultPlugins)
           .run();
   }
   ```
   This renders a window with a static “Hello, world!” window.

5. **Run it**:
   ```bash
   cargo run
   ```
   You should see `Hello, world!` printed to the terminal and a blank Bevy window.

### 2.2 Configuration Options <a id="config-options"></a>
Bevy ships with `DefaultPlugins` that enable many features (winit window, bevy_asset, bevy_log, etc.). If you need a lighter build for headless use (e.g. CI), replace the plugins:
```rust
use bevy::prelude::*;
use bevy::app::Builder;
fn main() {
   App::new()
       .add_plugins(CustomPlugin) // you can disable the bevy_log and bevy_window plugins
       .run();
}
```

### 2.3 Optimising Compiles <a id="optimise-compiles"></a>
- **Debug builds are slow** because the default `opt-level = 0`. Two steps dramatically cut compile time:
  1. **Enable small dev optimisations** in `Cargo.toml`:
     ```toml
     [profile.dev]
     opt-level = 1
     debug = 0          # disables debug symbols for faster builds (optional)
     ```
  2. **Run the compiler as a dynamic library** (Linux/Windows only):
     ```bash
     # Enable the `dynamic_linking` feature of Bevy.
     cargo run --features bevy/dynamic_linking
     ```
   - **Why?** This avoids static relink of the entire Bevy crate on each rebuild.

- **Alternative Linkers**
  - Install `lld` (LLVM's linker) and configure Cargo:
    ```toml
    # .cargo/config.toml (Linux example)
    [target.'cfg(target_os = "linux")'.x86_64-unknown-linux-gnu]
    linker = "lld"
    rustflags = ["-C", "link-arg=-fuse-ld=lld"]
    ```
  - On macOS the system linker is already fast. On Windows install `cargo-binutils` and use `llvm-tools-preview`.

- **Cranelift backend** (Linux nightly) – a faster code‑gen backend at ~30 % speed up, but **not stable for production builds**.

- **Nightly features**: add `nightly` to the `rust-toolchain.toml` to get access to the experimental fast‑compile optimisations (e.g. `-Zshare-generics=y`). This requires a nightly compiler.

### 2.4 Fast Build Tips (summary of the “Enable fast compiles” section) <a id="fast-build"></a>
- **Dynamic linking** + **LLVM ‑‑link‑plugin‑path** + **caching** can give 50‑% compile‑time reductions in typical Bevy projects.
- **Dynamic linking** may increase binary size and removes some optimisations; use only for local development when size is not a concern.
- **Mold** (a high‑speed link‑time optimiser) works on Linux but may conflict with `dynamic_linking`. If you see `"too many exported symbols"` switch to the LLVM LLD linker or disable the `dynamic_linking` feature.

---

## 3. ECS Fundamentals <a id="ecs"></a>
- **Entity** – a unique ID (a `usize` or `u32`), no data.
- **Component** – generic data struct without implementation, e.g. `struct MyRender { .. }`.
- **System** – `fn system_name(event: Res<Event>) { … }` receives **query & state** via argument types.
  - Queries can be **inclusive** (`&mut With<Health>`), **exclusive** (`&mut Without<Player>`), or **mutable exclusive** (`&mut Commands`).
- **Resources** – global, state‑like values (e.g. `State` struct) injected into systems.
- **AppBuilder** – where you add plugins and schedule order (`add_systems` vs `add_system` vs `add_start_system`).
- **Parallel Scheduler** – `SystemSet` decides which systems run simultaneously (no data races because of the ECS borrow checker).

**Tip:** Use `#[derive(Component)]` for any type you want to attach, and **avoid** `#[derive(Entity)]`.

---

## 4. Plugins & the Bevy Ecosystem <a id="plugins"></a>
- **Plugin trait** – provides `build(|app| …)` where you can add resources, systems, assets.
- **`bevy::prelude::App`** – a Bevy `World` plus `PluginCollection`.
- **Re‑use & share** – place your library in a *crate* that also depends on Bevy; ship as a plugin without pulling all Bevy features.
- **Examples** (from the UI):
  - *Breakout* – a simple 2D brick‑breaker, full source under `learn/quick-start/breakout`.
  - *Falling Sand* – cellular‑automata demo that showcases many ECS interactions.
  - *3D Puzzle Game* – a 3D game built on top of a plugin system.
- **Plugin Development** – use `build.rs` to compile shaders, `assets` folder, and `Assets` collection.
- **The Bevy ecosystem** – many add‑ons (`bevy_ecs_tilemap`, `bevy_audio`, `bevy_rapier2d`, etc.) follow the same plugin pattern.

---

## 5. Migration Guides (0.18 → later) <a id="migration"></a>
Bevy’s GitHub provides exhaustive migration guides for each major release:  
URL: `https://bevy.org/learn/quick-start/migration-guides/`  
In the docs you will see per‑release tables (0.16 → 0.17, 0.17 → 0.18) that list:

- **Removed** APIs (e.g. `App::insert_resource_now` is gone).
- **Replacements** (e.g. `add_plugin` now always uses `add_plugin(PluginName)`).
- **Breaking config changes** (e.g. `DefaultPlugins` now always enable `Msaa` on high‑DPI windows).
- **How to use the new `add_systems` API** instead of `add_system`.

You can follow the per‑issue migration note in the changelog (see `CHANGELOG.md` for 0.18.0).

---

## 6. Official Learning Path (Tutorials / Examples) <a id="tutorials"></a>
| Section | URL (relative) | Summary |
|---------|----------------|----------|
| **Quick‑Start** | `/learn/quick-start/introduction` | Design‑goal focused intro; see `introduction.md` (the page we just displayed). |
| **Getting‑Started** | `/learn/quick-start/getting-started` | Detailed guides for `setup`, `apps`, `ecs`, `plugins`, `resources`. Each sub‑page (e.g. `/setup/`) has code snippets and troubleshooting. |
| **Breakout** | `/learn/quick-start/breakout` | First “real” game – a Pong/Arkanoid hybrid, covers collision detection, entity‑spawning, UI. |
| **Falling Sand** | `/learn/quick-start/falling-sand` | Cellular automata using `Grid`, `Query`, and `Parallel` systems. |
| **3D Puzzle Game** | `/learn/quick-start/3d-puzzle-game` | Shows 3D rendering, lights, cameras, and a simple puzzle‑board system. |
| **Plugin Development** | `/learn/quick-start/plugin-development` | Walk‑through of creating a reusable Bevy plugin. |
| **Troubleshooting** | `/learn/quick-start/troubleshooting` | Common compile errors (e.g., ambiguous method `error_if`), missing `winit` features, and linking problems. |
| **Community** | `/learn/` root shows the navigation tree (as we observed) – you can dive into “Examples”, “Falling Sand”, “Next Steps”, etc. |

**How to navigate** – The UI uses a side‑menu; clicking a node loads the Markdown file under `https://bevy.org/content/learn/...`. The top‑level pages are static; you can also view the source directly to read the explanations.

### Example: 2‑D Sprite Rendering
1. **Add a sprite asset** (`assets/sprite.png`) and register it with the app:
   ```rust
   app.add_plugin(AssetPlugin::default())
       .insert_resource(Assets {
           // Bevy handles this automatically.
       });
   ```
2. **Create an entity with a `SpriteBundle`** in a system:
   ```rust
   fn spawn_player(mut commands: Commands, asset_server: Res<AssetServer>) {
       commands.spawn(SpriteBundle {
           texture: asset_server.load("player.png"),
           transform: Transform::from_xyz(0.0, 0.0, 0.0),
           ..Default::default()
       });
   }
   ```

---

## 7. FAQ & Common Issues <a id="faq"></a>
| Question | Answer / Fix |
|----------|---------------|
| **`cargo run` hangs on “Compiling bevy” for >5 min** | You are on a **debug build** with `opt-level = 0`. Add the dev‑optimisation entries shown in *2.3 Optimising Compiles* and re‑run. |
| **`cargo test` fails with “error: linker `lld` not found”** | Install `lld` (`sudo apt install lld clang` on Ubuntu, `brew install llvm` on macOS). Then add the Cargo config entries for `lld` (see *2.2 Alternative Linkers*). |
| **`bevy` version seems mismatched – `run` builds 0.15 but docs mention 0.18** | Ensure you are using the correct toolchain: `rustup default stable` and double‑check `Cargo.lock`. Also verify your `.cargo/config.toml` isn’t forcing an older version of the Bevy dependency. |
| **Wasm export times out** | Use the **“Fast Compile”** section: enable `opt-level = 3` in `release` and add `wasm-opt` CLI to your CI step (`cargo build --release && wasm-opt -Oz target/wasm32-unknown-unknown/release/my_game.wasm`). |
| **System ordering is wrong – my `RenderSystem` runs after `PhysicsSystem`** | Bevy’s default schedule is **order‑of‑registration**. Ensure you call `.add_systems(Update, render_system.before(physics_system))` to enforce the correct ordering. |
| **`Resource` value changes don’t propagate** | Be careful: mutable access to a resource requires `let mut res = resources.get_mut::<MyRes>().unwrap();` – you cannot re‑borrow the same resource in the same system as you read from other components that overlap. Use `Commands` or `State` to manage shared data. |

---

## 8. References (URLs to official docs) <a id="refs"></a>
- **Bevy Learning Hub** (all pages are markdown linked from the site): `https://bevy.org/learn/`
- **Quick‑Start – Introduction** – the page we just read: `./learn/quick-start/introduction.md`
- **Migration Guides** – detailed release notes: `https://bevy.org/learn/quick-start/migration-guides/`
- **Official Examples Repository** – each example lives in its own sub‑folder under `examples/` and is linked from the UI: `https://bevy.rs/examples/`
- **Bevy API Docs (Rust) – stable 0.18** – `https://docs.rs/bevy/0.18/bevy/`
- **Community Discord** – `https://discord.gg/bevy`
- **Changelog / Release notes** – `https://github.com/bevyengine/bevy/blob/main/CHANGELOG.md`

---

**Next Steps for Your Integration**
1. **Clone the repo** you will integrate (e.g., a game or editor). Keep the `Cargo.toml` from the *Getting Started* section.
2. **Use the ECS patterns** (bevy `world`, `systems`) exactly as shown in the tutorial snippets.
3. **Start a plugin** to encapsulate the parts of your engine that interact with the host application (e.g., expose a `BevyApp::new()` builder with a custom `MyEnginePlugin` that contains a `Resource` with a UI channel.
4. **Watch for breaking changes** before each 0.18.x → 0.19.x upgrade – read the appropriate migration guide.
5. **Leverage “fast compile”** (dynamic linking + LLVM LLD) for rapid iteration while developing.

Feel free to ask for more detail about any of the sections (e.g., a deeper dive into the `App::add_systems` API, or an example `Widget`‑style UI using `bevy_egui`).

---
*Generated from the official Bevy 0.18 documentation (as of 2025‑04‑13).*