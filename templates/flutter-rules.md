# Code review rules for Flutter / Dart

The generic rules apply plus the following Flutter-specific ones.

## Widgets and rebuild
- `setState` called outside the widget it belongs to → critical.
- `StatelessWidget` with mutable fields → bug-risk.
- Deep widget trees without extracting reusable widgets → minor.
- `BuildContext` captured and used after `await` without a `mounted` check → bug-risk.
- `MediaQuery.of(context)` or `Theme.of(context)` called in loops inside build → minor.

## State
- Provider/Bloc/Riverpod misused (e.g. recreating providers on every build) → major.
- `StreamController`s/`AnimationController`s without `dispose` → bug-risk.
- UI state stored in global variables without justification → minor.

## Performance
- `Opacity` over large subtrees (use `AnimatedOpacity` or `FadeTransition` instead) → minor.
- Large images without `cacheWidth`/`cacheHeight` → minor.
- `ListView` without `itemBuilder` for long lists → major.
- Missing `const` on widgets that could use it → nitpick.

## Async
- `Future` not awaited or returned (unintentional fire-and-forget) → bug-risk.
- Async calls in `initState` without error handling or unmount checks → bug-risk.

## Null safety
- Use of `!` (non-null assertion) without an obvious guarantee → bug-risk.
- Operations on nullable values without `??` or `?.` → minor.

## Platform
- Use of platform-specific APIs without a guard (`Platform.isIOS`) → bug-risk.
- Assets referenced without being declared in `pubspec.yaml` → critical.
