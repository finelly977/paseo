# Android

## App variants

Controlled by `APP_VARIANT` in `packages/app/app.config.js` (vanilla Expo, no custom Gradle plugin):

| Variant       | App name    | Package ID       |
| ------------- | ----------- | ---------------- |
| `production`  | Paseo       | `sh.paseo`       |
| `development` | Paseo Debug | `sh.paseo.debug` |

EAS profiles: `development`, `production`, and `production-apk` in `packages/app/eas.json`.

`development` uses Android `debug`.

## Version codes

`packages/app/app.config.js` derives Android `versionCode` from the package version with:

```text
major * 1_000_000 + minor * 1_000 + patch
```

Prerelease metadata is ignored, so `0.1.102-beta.1` and `0.1.102` both produce `1102`. The same value is used as the iOS `buildNumber` because `packages/app/eas.json` uses EAS's local app version source. Do not re-enable EAS remote version counters or Android `autoIncrement`; F-Droid and other source-based builders need the native build number to be visible in the repo.

The formula reserves three digits each for minor and patch. If either reaches `1000`, change the formula before cutting that release.

## Prerequisites (local dev)

Local Android builds run on macOS (or Linux) and need the Android toolchain, pinned in `.tool-versions` (`java 21`, `android-sdk 21.0`) and wired up by `.mise.toml` (which derives `ANDROID_HOME` and the command-line tool paths from the `android-sdk` entry). With [mise](https://mise.jdx.dev):

```bash
mise install        # java 21 + android-sdk 21.0 command-line tools
```

> **Pin a real `android-sdk` version, not `latest`.** The mise `android-sdk` plugin's `latest` resolved to the ancient `1.0` bundle, whose `sdkmanager` (3.6.0) predates the `emulator` package and fails with `Failed to find package emulator`. `21.0` ships a current `sdkmanager`. If you bump it, update only the version in `.tool-versions`; `.mise.toml` derives its paths from that tool entry.

`mise install` only lays down the command-line tools. Install the rest and create an emulator. On Apple Silicon:

```bash
sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "platforms;android-35" "build-tools;35.0.0" \
           "system-images;android-35;google_apis;arm64-v8a"
avdmanager create avd -n paseo -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_7
emulator @paseo     # start it; leave running
```

On an Intel Mac, use the `x86_64` system image:

```bash
sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "platforms;android-35" "build-tools;35.0.0" \
           "system-images;android-35;google_apis;x86_64"
avdmanager create avd -n paseo -k "system-images;android-35;google_apis;x86_64" -d pixel_7
emulator @paseo     # start it; leave running
```

Gradle auto-fetches the platform/build-tools it needs once licenses are accepted, so adjust `android-35` only if it asks for a different level.

## Local build + install

From repo root:

```bash
npm run android:development    # Debug build
npm run android:production     # Release build
npm run android:clear          # Remove generated Android project
```

Or from `packages/app`:

```bash
# Debug
npx cross-env APP_VARIANT=development expo prebuild --platform android --non-interactive
npx cross-env APP_VARIANT=development expo run:android --variant=debug

# Release
npx cross-env APP_VARIANT=production expo prebuild --platform android --non-interactive
npx cross-env APP_VARIANT=production expo run:android --variant=release

# Clear generated Android project
rm -rf android
```

## Running on an emulator against a worktree daemon

`npm run android` builds and installs the dev client, but two connections have to reach your Mac from inside the emulator — Metro (the JS bundle) and the Paseo daemon — and **the emulator does not share the host's loopback**: `localhost` inside the emulator is the emulator itself. Reach the host at `10.0.2.2` (the standard AVD's host alias) for both:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2 \
  EXPO_PUBLIC_LOCAL_DAEMON=10.0.2.2:$PASEO_SERVICE_DAEMON_PORT \
  npm run android
```

- **`REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2`** — without it, Expo bakes your Mac's LAN IP into the dev client's Metro URL, which the emulator can't route to, and the app dies with `Failed to connect to /<lan-ip>:8081` before any JS loads.
- **`EXPO_PUBLIC_LOCAL_DAEMON=10.0.2.2:<port>`** — the client's daemon endpoint (`packages/app/src/runtime/host-runtime.ts`); when unset it defaults to `localhost:6767`, the production daemon. Use `$PASEO_SERVICE_DAEMON_PORT` for a worktree daemon running as a Paseo service, or `6768` for a standalone `npm run dev:server`. It is inlined into the JS bundle at Metro bundle time, so set it on the build command and clear the Metro cache (`npx expo start -c`) if a change doesn't take.

**Alternative — `adb reverse` + `localhost`** (if `10.0.2.2` misbehaves):

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:$PASEO_SERVICE_DAEMON_PORT tcp:$PASEO_SERVICE_DAEMON_PORT
REACT_NATIVE_PACKAGER_HOSTNAME=localhost \
  EXPO_PUBLIC_LOCAL_DAEMON=localhost:$PASEO_SERVICE_DAEMON_PORT \
  npm run android
```

This is the Android counterpart of the iOS local-simulator flow in [development.md](development.md): on iOS the simulator shares the Mac's loopback so `localhost:<port>` works directly; on Android you need `10.0.2.2` or `adb reverse`.

## F-Droid / source-only Android builds

F-Droid builds should set `PASEO_FDROID_BUILD=1` when running Expo prebuild:

```bash
cd packages/app
PASEO_FDROID_BUILD=1 APP_VARIANT=production npx expo prebuild --platform android --clean --non-interactive
cd android
PASEO_FDROID_BUILD=1 ./gradlew assembleRelease --no-daemon --max-workers=1 -Dorg.gradle.parallel=false
```

The flag must be present for both prebuild and Gradle because Gradle starts Metro for the release bundle. Keep the source build serial and daemon-free as shown above: compiling every Expo module can exhaust memory when Gradle workers run in parallel. The profile enables source-built Expo modules, excludes the proprietary camera, Firebase notification, and Expo development-client native modules, disables EAS updates and Gradle dependency metadata, and substitutes JavaScript stubs for camera and notifications. The resulting app supports direct and pasted-link pairing but not QR scanning or push notifications.

For a single-ABI APK, pass React Native's architecture property to Gradle:

```bash
PASEO_FDROID_BUILD=1 ./gradlew assembleRelease \
  -PreactNativeArchitectures=arm64-v8a \
  --no-daemon --max-workers=1 -Dorg.gradle.parallel=false
```

Supported values are `armeabi-v7a`, `arm64-v8a`, `x86`, and `x86_64`. The F-Droid profile filters native libraries to that ABI and changes the APK version code to `baseVersionCode * 10 + abiSuffix`, where the suffixes are ordered `1` through `4` in that same sequence. F-Droid metadata should use four build blocks with `VercodeOperation` entries `10 * %c + 1` through `10 * %c + 4` and pass the matching `reactNativeArchitectures` value in each build command. Builds without a single architecture keep the base version code.

Keep the excluded npm packages installed. Normal builds use them, while the F-Droid profile removes only their Android native modules and config plugins. Paseo always applies `expo-gradle-jvmargs` with `-Xmx4096m` and `-XX:MaxMetaspaceSize=1024m` so local Expo prebuilds have enough Gradle heap whether they use precompiled AARs or source-built Expo modules.

The EAS `production-apk` profile uses the large Android resource class. Release builds compile the native ABIs and run Hermes bundling in the same Gradle invocation; the default worker can exhaust its remaining memory and kill Hermes with exit code 137 even when Gradle's own heap is correctly sized.

### React version lockstep

Keep `react` and `react-dom` pinned to the React version embedded by the current `react-native` release. React Native `0.81.x` embeds `react-native-renderer` `19.1.0`, so `packages/app` must use React `19.1.0`. Bumping React to a newer patch can build successfully but crash at JS startup on Android with `Incompatible React versions`, leaving the app on the native splash screen.

## Screenshots

```bash
adb exec-out screencap -p > screenshot.png
```

## Cloud build + submit (EAS)

Stable tag pushes like `v0.1.0` trigger:

- The EAS GitHub app on Expo servers (iOS + Android production builds + store submit). There is no workflow file in this repo for it.
- `.github/workflows/android-apk-release.yml` on GitHub Actions (APK asset on GitHub Release).

iOS auto-submits to App Store review via a Fastlane lane after EAS uploads to TestFlight. Android auto-submits to the Play Store via EAS-managed credentials.

Beta tags like `v0.1.1-beta.1` only trigger the GitHub APK workflow. They publish a GitHub prerelease APK for testing and do not submit to the stores.

`android-v*` tags also trigger only the GitHub APK workflow — useful when you want to ship an APK without going through stores. The GitHub APK workflow supports `workflow_dispatch` with an existing `tag` input so you can rebuild without cutting a new tag.

### Useful commands

```bash
cd packages/app

# Recent builds
npx eas build:list --limit 10 --non-interactive --json | jq '.[] | {platform, status, appVersion, gitCommitHash}'

# Inspect a build (the printed `Logs` URL opens the build's Expo dashboard page,
# which has a Submissions section showing the auto-submit to the Play Store).
npx eas build:view <build-id>
```

The Play Console (Internal testing → Production tracks) is the final confirmation that the binary reached the store.

See [docs/release.md](release.md) for the full mobile-build babysitting flow.

## 二开本地 APK

本地侧载安装包在 Expo prebuild 与 Gradle 两阶段都设置 `PASEO_LOCAL_APK=1`，停用指向上游 Expo 项目的 OTA 更新，保留相机配对等常规功能。不要使用上游 EAS 账号或发布上游商店版本。

### 二开 GitHub 应用内更新

安卓版在“设置 → 关于 → 安卓应用更新”检查 `finelly977/paseo` 的公开 GitHub Releases，只接受 `android-apk-vX.Y.Z` 正式发布中的 `Paseo-X.Y.Z-android.apk`。草稿、预发布、桌面标签、相同或更低版本不会作为更新。下载期间显示进度，离开设置再回来仍保留当前任务；网络和校验失败显示重试入口，不会谎报已是最新。

下载完成后原生侧校验 GitHub 提供的 SHA256、大小、包名、版本号和安装签名，再打开安卓系统安装确认。首次需要在系统设置允许 Paseo 安装应用，返回后点击“继续安装”，无需再次下载。APK 下载与校验在后台队列运行，不在 UI 线程读取整包。更新保留配对、设置和应用数据，不更新远程守护进程。旧 APK 没有此入口，第一次仍需手动覆盖安装带此功能的版本。

当前侧载系列继续沿用原已分发测试签名以支持覆盖安装，不冒充官方商店签名。密钥备份在被 Git 忽略的 `packages/app/.secrets/android-local.keystore`，生成原生工程后、执行 Gradle 前复制到 `android/app/debug.keystore`；保管备份，不上传仓库。未来不能直接更换签名，否则已安装用户无法覆盖更新。需改用独立正式密钥时，必须另行设计迁移。

后续发布可在同步、递增版本并提交推送二开 `main` 后，点击工作区运行菜单的“打包并发布 Android”，自动完整构建、校验并发布；中断后重新点击可继续同一草稿。具体前提见 [release.md](release.md#二开工作区安装包发布按钮)。也保留已经构建及验收 APK 的手动发布方式：

```powershell
.\scripts\publish-android-apk.ps1 -ApkPath '.output\deliverables\Paseo-0.2.3-android.apk' -NotesPath '.output\android-release-notes.md' -SdkRoot $env:ANDROID_HOME
```

脚本检查包名、版本、签名与干净源码，上传草稿并核对 GitHub 资产摘要后正式发布。上传完成但后续步骤失败时，检查现有草稿后可加 `-ResumeDraft` 继续校验和发布，不重复上传；正式发布的版本禁止覆盖。`android-apk-v*` 不触发原作者的 `v*` / `android-v*` EAS 与商店工作流，不发布 npm。未来使用者在应用内检查、下载并确认系统安装即可，不再手工传 APK。

Windows 的仅构建入口使用已安装 JDK、Android SDK 和生成工程内的 `gradlew.bat`。依赖与 SDK 下载完成后，执行：

```powershell
$env:JAVA_HOME = '<JDK 绝对路径>'
$env:ANDROID_HOME = '<Android SDK 绝对路径>'
npm run build:android:apk
# 仅检查本地工具与签名备份，不构建：
npm run build:android:apk -- -CheckOnly
```

脚本依次重建应用依赖、终端与 Mermaid 资源、生成原生工程、复制原侧载密钥，再使用单 Gradle worker、双 Metro worker 构建 ARM64 与 x86_64 Release APK；不跳过前端编译。构建后恢复被生成器改写的受控资源源码和临时 Gradle 并行设置；若资源在构建期间被外部修改，保留该修改并停止，不覆盖用户编辑。产物复制到 `.output/deliverables/Paseo-X.Y.Z-android.apk`，并校验包名、版本、同签名及原生库 16 KB 对齐；不会自动上传或安装。`arm64-v8a` 适用于现代 64 位 Android 手机，当前最低 Android 10；`x86_64` 便于隔离模拟器验收。沿用持久备份的原侧载测试签名，不更换签名，也不冒充官方安装包。生成的 SDK、构建日志和交付副本保留在本地 `.output`，不提交构建产物或密钥。

Windows 原生打包需要 EXPO_NO_METRO_WORKSPACE_ROOT=1，使 Gradle 传入的相对入口按应用目录解析。Metro 在此模式下显式监听 packages 与仓库根 node_modules，并保留两层依赖路径，避免共享包的链接被当作不存在；普通网页和开发服务器不启用该标记。

### Android 冷启动验收

本地 APK 交付不能只检查 Gradle、签名、包名和字节码。必须在隔离安卓设备或模拟器安装 Release APK，冷启动后确认 `welcome-screen` 或实际业务界面已经出现，`startup-splash` 消失，且 `logcat` 中没有 React Native JavaScript 启动异常。没有真机时应明确记录模拟器和 ABI，不把未进行的真机验证写成已通过。

原生启动失败时先保留 `logcat`，使用同一次构建的 `app/build/generated/sourcemaps/react/release/index.android.bundle.map` 还原 Hermes 堆栈。Android Hermes 不提供 `Intl.RelativeTimeFormat`，Git 提交相对时间使用应用自己的单位计算与语言资源，不能在被根布局导入的模块顶层创建该格式器；由此引发的后续路由 `ErrorBoundary` 缺失不应被误判为 Expo Router 的首个错误。

x86_64 模拟器即使声明支持 ARM 翻译，也可能无法通过 SoLoader 从未解压的 ARM64 APK 读取原生库。此类原生库错误不能直接当作 ARM64 手机故障；应使用包含模拟器 ABI 的安装包验证，确保诊断包与交付包使用相同的前端字节码。用户已有手机或模拟器数据不应为启动诊断被清除。
