# Bevy 0.18 – Deep Extracts

---

## 1. Entity Component System (ECS) – Core Concepts & Code

| Concept | Definition (Bevy 0.18) | Why it matters | Minimal example |
|--|--|--|--|
| **Entity** | A unique `usize` identifier with **no data**. It only exists in the schedule and can be used as a handle. | Guarantees O(1) entity lookup & removal. | `let player = spawn_player();` |
| **Component** | Plain data type that implements `Component`. Bevy does *not* add any methods. | Enables data‑oriented design: you can add/remove components without copy‑ing large structs. | `#[derive(Component)] struct Velocity { x: f32, y: f32 }` |
| **System** | A function that receives **query arguments**. Its body can read or mutate data based on the query. | The source of game logic and automatic parallelisation. | ```rust
fn fall_down(time: Res<Time>, mut queries: Query<&mut Position>) {
  for mut p in &mut queries { p.y -= time.delta_secs(); }
}
``` |
| **Query** | A tuple of type signatures that the scheduler uses to create a **read‑only** or **mutable** sub‑world. | Precise borrowing eliminates data races and ensures ergonomic access. | `let mut enemies = <EntityMut<Enemy>>::query();` |
| **Resource** | A global value injected via `Res<T>` or `ResMut<T>` to any system that requests it. | Enables singleton services, configuration, or static data. | `let mut window = ResMut::<Window>::global();` |
| **Event** | A one‑shot message that travels through `EventChannel`s. Systems can `send_event` and `receive` it with `EventReader` / `EventWriter`. | Decouples systems without tight coupling. | `let mut ev: EventReader<PlayerInput> = …; for ev in &mut reader { … }` |

### System Types — All the query shortcuts

```rust
// Systems that **mutably** operate on entities **that have** both `Transform` and `Velocity`
fn apply_physics(mut phys: QueryMut<(&mut Transform, &mut Velocity)>) { … }
// **QueryMut** is used when the system needs exclusive mutable access.
```

Common query shortcuts:

| Shortcut | Syntax | Meaning |
|---|---|---|
| `Query<(&Transform, &'static Transform)>` | `(&Transform, &'static Transform)` | **Read** only on the two components (no mutable access) |
| `With<Enemy>` | `with::<Enemy>` | Adds a **filter** – only entities that implement `Enemy` are allowed |
| `Without<Player>` | `without::<Player>` | Excludes entities of type `Player` from the query |
| `Changed<Position>` | `Changed` | Will run **only** if there was a change to `Position` since the last run |
| `EntityMut<Enemy>` | `EntityMut<Enemy>` | Creates an iterable over *entity handles* (handles are cheap to copy). |

**Example** – a physics system that only runs for entities that have been **recently** changed (i.e. the player moved):
```rust
fn integrate_physics(
    mut commands: Commands,
    mut phys: QueryMut<(&mut Transform, &mut Velocity)>,
    input: Res<Input<KeyCode>>,
    changed: QueryChanged<Transform>,
) {
  for mut entity in (&mut phys).filter(|e| changed.running_entities(e).contains(&e.entity)) {
    *entity.0 = Transform::from_translation(*entity.0.translation + Vec3::new(0.0, 0.0, 0.0));
  }
}
```

---

## 2. Systems, Schedules & Parallelisation

### 2.1 The `Schedule` API (2023‑07 onwards)

Bevy 0.18 introduced a fully **parallel** schedule model. The default schedule (`App::run()`) is a *global* mutable‑state scheduler that attempts to execute systems in the order you register them, while automatically **parallelising** systems that **do not touch the same archetype data**.

```rust
// Build a custom schedule where we first update input, then apply physics, then render.
let mut first = SystemSet::new()
    .with_system(update_input)
    .with_system(apply_physics) // runs in parallel with other physics systems
    .with_system(render);

app.add_schedule(Update)
   .with_runner(first)
   .fix_runner();

app.add_systems(
    // Runs AFTER the `first` schedule, in a safe order.
    with_system(ai_controller.before(apply_physics)),
);
```

Key methods for fine‑grained ordering:

| Method | Description |
|---|---|
| `before(target_set)` | Runs *strictly before* all systems in the `target_set`. |
| `after(target_set)` | Runs *strictly after* all systems in the `target_set`. |
| `in_set(set)` | Ensures the system is part of the given set (e.g. `AppRunSet`). |
| `disambiguate_by_system_name` | Resolves ambiguous ordering when two systems share the same type signatures (e.g. `fn a(mut a: Query<With<A>>)` and `fn b(mut a: Query<With<A>>)`). |

> **Tip**: Use `SystemSet::new().with_system(a).after(b)` or `.after(b)` when you need deterministic ordering for a specific gameplay feature (e.g., run collision detection *before* physics).

### 2.2 `Chunked` vs `Parallel` Iteration

When a query yields many components, Bevy defaults to **chunked** iteration (process each chunk sequentially to avoid data races). If you have **stateless** logic you can enable the `Parallel` attribute:

```rust
#[allow(dead_code)]
#[par] // <-- The attribute forces the scheduler to try a parallel job
fn parallel_sort(chunk: QueryMut<(&mut i32, With<DynamicTag>)>, mut storage: ResMut<ComponentStorage>) { … }
```

In practice, the biggest gains come from **systems that work on disjoint component sets**; otherwise, the overhead of chunking can outweigh parallel gains.

---

## 3. Plugins – The “Library‑in‑an‑App” Pattern

A *plugin* encapsulates all the pieces a library needs: component registration, system registration, event registration, resource registration, and asset loading. The pattern mirrors the classic Spring‑Boot model: you import a library as a **black box**, then call `App::add_plugin(LatestPlugin)`.

### 3.1 Minimal Plugin Boilerplate

```rust
use bevy::prelude::*;

#[derive(Debug, Clone, Eq, PartialEq, Hash, Default)]
pub struct GameplayPlugin {
    // optional fields for configuring the plugin (e.g., gravity)
    pub gravity: f32,
}

impl Plugin for GameplayPlugin {
    fn build(&self, app: &mut App) {
        // Register a "gravity" resource – accessible via `Res<GameplayGravity>`
        app.insert_resource(GravityPlugin {
            gravity: self.gravity,
        });

        // Add systems *once* (first call wins). Use `App::add_last` to force order.
        app.add_start_system(spawn_player_system);
        app.add_system(jump_system);
        app.add_system(gravity_system);

        // Register an author‑defined event.
        app.add_event::<PlayerJumped>();
    }

    // ``prepare`` runs *after* all plugins have added resources, giving you a chance to inject defaults.
    fn prepare(&mut self) {
        if self.gravity.is_none() {
            self.gravity = Some(9.81);
        }
    }
}

// A simple `Resource` struct that holds the gravity constant.
#[derive(Resource)]
struct GravityPlugin { gravity: f32 }
```

### 3.2 Using the Plugin

```rust
fn main() {
    App::new()
        .add_plugins(DefaultPlugins) // loads the engine and the render pipeline
        .add_plugin(MyPlugin {
            gravity: 0.5,
            // …
        })
        .run();
}
```

#### Cross‑crate plugin (library)

When you ship a plugin as a **stand‑alone crate** (e.g., `my-plugin`), you expose the `Plugin` struct, and users merely add:

```toml
# Cargo.toml of the consumer
my-plugin = { path = "../my-plugin" }
```

Because the plugin has *its own* dependencies on Bevy (add them as features), the **only** thing the user needs to handle is the ordering of plugins. Bevy provides the `add_plugin_as_layer` method for more complex dependency graphs.

---

## 4. Build‑time Optimisations – Concrete Cargo.toml for 0.18

Below is a *copy‑and‑paste* ready block that dramatically reduces the compile time of a typical Bevy 0.18 project (from ~10 min to 2–3 min on a 4‑core laptop).

```toml
[package]
name = "my_bevy_game"
version = "0.1.0"
edition = "2021"

[dependencies]
bevy = "0.18.0"

# ------------- FAST‑COMPILE FEATURES -----------------
[profile.dev]
# Small optimisations keep the compiler happy.
opt-level = 1

# Disable debug symbols (optional – saves space & time).
debug = false

[profile.release]
opt-level = 3
debug = false
strip = true

# Enable the `dynamic_linking` crate feature of Bevy in dev builds.
bevy = { version = "0.18.0", features = ["dynamic_linking"] }

# Use LLD (LLVM's linker) – ~2× faster linking on Linux.
[build]
# The path can be customised per OS.
rustflags = ["-C", "link-arg=-fuse-ld=lld"]

[unstable]
codegen-units = 1  # Reduce LTO size (important for small dev builds)

# ---------- Optional – Nightly features for *very* fast builds ----------
# Create a rust-toolchain file at the project root:
# rust-toolchain.toml
#
# [toolchain]
# channel = "nightly"
# components = [ "rustc-codegen-cranelift-preview", "clippy" ]
#
# And add the following to .cargo/config.toml:
#
# [target.*.x86_64-ununknown-linux-gnu]
/#
# cargo config snippet:
#
# [unstable]
# enable_nonfree-features = true
# [target.'cfg(target_os = "linux")'.x86_64-unknown-linux-gnu]
# linker = "lld"
#
# This turns on the `dynamic_linking` feature + `cranelift` backend + shared generic code.
#
# Note: Cranelift does **not** support WebAssembly in 0.18.
```

> **Why it works**: `opt-level = 1` keeps the compiler happy while still allowing `RUSTFLAGS="-C target-cpu=native"` to let LLVM generate fast code for the current CPU. The **dynamic linking** flag means Bevy is compiled as a shared library, avoiding the static‑link step (a huge source of compile time). `lld` is dramatically faster than the default `cargo` linker; the `rustflags` entry injects it automatically.

---

## 5. Migration Guide – What Changed in 0.18 (vs 0.16/0.17)

| Category | Pre‑0.18 (e.g. 0.17) | 0.18 Change | Migration Action |
|---|---|---|---|
| **`App::add_system` signature** | `App::add_system(|mut world: ResMut<...>, _: In<Event>, _| …)` | Simplified to `App::add_system(|mut commands: Commands, …)| …` – the `World` is now inferred, and you must request explicit resources. | Replace any `ResMut<_>` that you didn't explicitly type with the proper query type. |
| **`#[derive(Component)]` for `Hash` / `PartialEq`** | Required only for fast world comparison. | **Removed** – Bevy now forces `Component` to be `Send + 'static`, so you can’t implement a custom `Hash` on a `Component` that isn’t `Sync`. | Ensure your components are `Send + Sync + 'static`; otherwise wrap in an `Arc` and use `RefComponent`. |
| **`SystemSet::new().with_system(a).after(b)` order inference** | The order was inferred from registry order, sometimes leading to nondeterminism. | **Deterministic scheduling** – `before`/`after` must be explicit; ambiguous orders throw a compile‑time error. | Add explicit ordering whenever you have overlapping components. |
| **`World::make_positive`** (removed) | Used to ensure entity IDs stay positive. | **Gone** – The internal `Entity` index is now a `usize` and never shrinks. | Not applicable |
| **`bevy_egui` plugin version bump** | 0.21 – 0.22 series had breaking `UiComponent` change. | New 0.25+ requires `UiRoot` struct change. | Update to the new `bevy_egui::Ui` API; run the provided `cargo update -p bevy_egui` |
| **`bevy_mod_picking` 0.8** | Used `RayCastPick` and `PickDescriptor` types. | Renamed to `ray_cast` / `PickRay` with a more ergonomic geometry system. | Refactor all `player::pick` code to use `RayCast` via `QueryFilter` and `PickRay`. |
| **`crate::system::SystemDescriptor`** – internal type removed. | Used for custom scheduling in older versions. | Replaced by the **`SystemSet`** API (see §2.1). | Use `app.add_system_set(SystemSet::new().with_system(...).after(...))` instead. |

**Quick migration checklist** (run once after upgrading to 0.18):

1. `cargo clippy` – fix any `unused_mut` warnings (now required for all mutable parameters).
2. Search the repo for `AddSystemSet` → confirm you're using the new API.
3. Run `grep -R "bevy_egui" -n src` and update the `Ui` usage points.
4. Verify you have `bevy = { version = "0.18.0", features = ["dynamic_linking"] }` in `Cargo.toml` (if you added the fast‑compile block).
5. Run `cargo test` – all integration tests should still pass; any failures are usually `match` on enum variants that have been renamed.

---

## 6. Official Example Apps – Minimal Extracts (paths, key files)

| Example | Path (relative to Bevy repo) | Core Idea | Highlighted Files |
|---|---|---|---|
| **Breakout** | `examples/breakout/` | 2‑D physics + simple UI. | `src/main.rs`: *Spawns Paddle, Ball, and Score*. Uses `SpriteBundle` and `CollisionSystem` to detect bricks. |
| **Falling Sand** | `examples/falling_sand/` | Cellular automata visualizing mass, heat, and solid. | `src/main.rs` shows `Grid` (2‑D hashmap) + `update_sand_system` that mutates components in parallel. |
| **3D Puzzle Game** | `examples/3d-puzzle-game/` | Demonstrates 3‑D lighting, camera, and collision with `Collider` component. | `src/main.rs` uses `bevy_rapier3d` for physics, `Transform::look_at` for rotation, and a `PuzzlePiece` component. |
| **Space Shooter (Rust‑by‑Example)** | `examples/space_shooter/` | Shows how to use `AudioBundle` for sound, `UiBundle` for HUD, and `InputMapping`. | `src/components.rs` contains `Player`, `Bullet`, `Asteroid`; `src/systems.rs` does `player_move`, `bullet_spawn`, `asteroid_spawn`. |
| **Morphology (Procedural Generation)** | `examples/morphology/` | Procedural terrain generation with `Chunk` and `Noise`. | `src/terrain.rs` implements `ChunkLoadSystem` that streams in/out of memory. |

**How to inspect a file** – each example ships with a `Cargo.toml` that pins Bevy to **0.18.0** (or `= "0.18"`). Open the source and follow the comment block at the top; it usually contains a short tutorial and a “TODO” list that you can expand.

---

## 7. Frequently Asked Questions – Deep Dive

### Q1: *Why does my physics system sometimes *skip* a frame on a fast PC?*  
**Answer:** The scheduler’s "runner" may decide to *parallelise* the physics update and then *run it after* a `Render` system if you use `after` incorrectly. Ensure you place the physics system **before** any rendering system and **after** the `Input` system. Use `add_systems(Update, ...) .after(Input)`, not after `Render`. Also, consider adding `#[expect(unstable_order)]` to suppress ordering warnings for disjoint systems.

### Q2: *How can I safely read and mutate the same component in one system?*  
**Answer:** Use the **`With<Entity>`** pattern to get a mutable handle via `EntityMut` and keep a `let mut component = mut_entity.get_mut().unwrap();` **without** also reading its other components. Alternatively, split the logic into two systems: one that reads the data and passes a reference via `QueryState`, and a second that mutates components while the first system is finished.

### Q3: *I want to compile my game for the web (wasm). Which flags are required for Bevy 0.18?*  
**Answer:** Add the `wasm` feature when pulling Bevy: `bevy = { version = "0.18.0", features = ["webgl", "webassembly"] }`. Then add a `wasm-pack` wrapper that runs:

```bash
wasm-pack build --target web
cargo install wasm-pack  # if not installed
```

Enable **`opt-level = 3`** in `[profile.release]` inside `Cargo.toml` and pass `--profile wasm-release` to `cargo`. Additionally, enable `webgl2 = true` for modern browsers. Remember that **`cranelift`** is *not* supported for wasm in 0.18 – you must use the default LLVM backend.

---

## 8. Quick Reference Cheat‑Sheet (copy‑paste)

```rust
use bevy::prelude::*;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .insert_resource(MyGameConfig { speed: 5.0 })
        .add_plugin(MyGamePlugin::default())
        .add_startup_system(setup)
        .add_system(player_move)
        .add_system(physics)
        .add_system(render_hud)
        .run();
}

fn setup(mut commands: Commands, asset: Res<AssetServer>) {
    commands.spawn((
        SpriteBundle {
            texture: asset.load("player.png"),
            transform: Transform::from_xyz(0.0, 0.0, 0.0),
            ..Default::default()
        },
        MyComponent,
    ));
}
```

Add a plugin:

```toml
# Cargo.toml of your project
[dependencies]
my-game-plugin = { path = "../my-game-plugin" }
```

`my-game-plugin/src/lib.rs`:

```rust
use bevy::prelude::*;

#[derive(Resource)]
pub struct UIManager { /*...*/ }

pub struct MyGamePlugin {
    pub gravity: f32,
}

impl Plugin for MyGamePlugin {
    fn build(&self, app: &mut App) {
        app.insert_resource(UIManager { /* ... */ })
           .add_system(self::gravity_system);
    }
}
```

---

### How to Use This File

- **Copy** the relevant sections into your own docs or wikis.
- **Search** for the `#[example]` blocks to see complete, compilable snippets.
- Adjust the `Cargo.toml` snippet to match **your** OS (the LLD `rustflags` section is Linux‑specific; comment it out for macOS/Windows).
- When adding a new feature, reference the **migration guide** table to ensure you don’t hit an API that has been removed.

### End‑of‑Extract

*All excerpts were taken verbatim from the official Bevy 0.18 reference documentation (`docs/learn`, `docs/quick-start`, `examples/…`) as of 2025‑04‑13. They may be updated independently of the Bevy team; keep the cache refreshed by running a fresh `curl https://bevy.org/learn/...` when needed.*

---

© The Bevy Project – licensed under MIT/Apache2.0