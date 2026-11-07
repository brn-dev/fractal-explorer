# Fractal Explorer for Android

The full existing web explorer runs inside a bundled, offline Android WebView. The same APK adds separate cover/main wallpaper designs, native video encoding, package import, and a native live-wallpaper player. The wallpaper plays pre-rendered videos; it does not keep the WebView or fractal renderer running behind the home screen. Hinge tracking and Shizuku are not needed.

The APK is generated at `../artifacts/android-wallpaper/fractal-wallpaper.apk`. Version 0.9.0 uses the same application ID and development certificate as the earlier player prototype, so it installs as an update. Open **Fractal Explorer**, then use **Export → Create wallpaper**. **Wallpaper gallery** opens your saved collection; **Wallpaper settings** opens native playback settings and imports. **Set up on both screens** opens the inner/cover setup guide described below.

The explorer shares its WebGPU recovery with the website: it verifies the current scene's compute pipeline before declaring the GPU ready, compiles smaller formula-specific kernels, and retries internal Vulkan pipeline failures up to three times. A persistent failure or lost device switches exploration to CPU rendering; **Rendering → Retry GPU** can reconnect without restarting or changing a paused fractal. The actual Adreno startup issue still needs confirmation on the phone; local Chrome tests deliberately inject the error and exercise both recovery paths. Native wallpaper playback is unaffected by the explorer's GPU availability.

## Create the four states

| State | Playback |
| --- | --- |
| Just closed | Starts when the cover becomes active, plays once, then reaches Closed. |
| Closed | Holds the small display's still image or repeats its steady animation. |
| Just opened | Starts when the inner screen becomes active, plays once, then reaches Open. |
| Open | Holds the large display's still image or repeats its steady animation. |

1. Open **Export → Create wallpaper** and choose **Design for → Main screen / Cover screen**. Switching screens keeps each working draft separately, including its name, timing and quality settings.
2. Design **Open / Closed** with **Edit end / steady scene**; it is both the transition endpoint and the first loop frame. Then edit **Just opened / Just closed** with **Edit start scene**. View start/end previews the saved scenes. Parameter automation belongs to the steady scene and is disabled while editing a start.
3. Set transition duration and motion curve. Geometry uses the selected easing; the default starts fast and eases out.
4. Choose **Colors in both scenes** and **Color cycle · seconds**. Both clips use the same palette, density and constant color speed; palette edits in either scene update both. The effective period fits whole cycles into the loop and is displayed. Transition phase is offset to match the loop's first phase exactly. **Keep colors still** disables color motion in both. Different formulas/settings blend with the same palette.
5. Choose animated steady playback or transitions only, idle duration, resolution and frame rate. The minimum loop duration grows as needed to preserve every chosen parameter speed exactly, without retiming individual channels. Preview the pair.
6. Tap **Create main / cover wallpaper**. Only that screen's two clips and poster are rendered and saved; the other selection is unchanged. Use **Set up on both screens** if Samsung still needs its wallpaper components assigned. Gallery switches then require no rendering.

**Resolution** defaults to **Match this screen exactly** on Android. Open the app once on each panel (folded and unfolded) so it records both physical display modes, then use **Detect resolution** if needed. Android dimensions are authoritative: imported sizes from another phone cannot pretend to be detected local pixels. Browser exports may use dimensions saved in an exported draft. The 480 px designer preview is separate from full-resolution export.

**Fractal supersampling** inherits the explorer setting when creating a design or saving either scene, and can also be set explicitly in the wallpaper designer. 2× renders twice the width and height (four samples per output pixel); the colored image is downsampled before video encoding. Both clips and the matching poster use the same sampling. Video dimensions stay at the chosen resolution. This increases creation time and memory use, with no additional playback rendering. Old drafts default to 1×. Requests above the current renderer's dimension/pixel limits fail clearly; sampling is never silently reduced. A GPU failure also rechecks the smaller CPU limits before starting fallback work.

## Render on your PC

Native resolution with supersampling can take a long time on a phone. You can design on the phone and render the same wallpaper using the PC browser's GPU instead:

1. In the phone's wallpaper designer, finish saving the start and steady scenes, choose the screen's native resolution, sampling and quality, then tap **Render on PC…**. No videos are rendered during this step.
2. **Copy PC link** or **Share PC link…** and open it on your PC in Chrome or Edge. The link contains the selected screen's two scenes, exact decimal parameters, animation, palette, timing, resolution and quality. It opens the wallpaper designer after the browser renderer initializes; an existing working draft is replaced only after confirmation.
3. Check **GPU rendering** below the designer. If it says CPU, use **Rendering → Retry GPU** before starting a large export. Choose **Download main / cover wallpaper** and keep the tab visible until it finishes. This creates a ZIP containing that screen's rendered videos, poster and editable design.
4. Transfer the ZIP to your phone. In **Wallpaper settings → Import wallpaper package**, select it. The app keeps it in your gallery and selects it for that screen, with no phone-side fractal rendering. The other screen's selection is unchanged.

If the link is too long, **Download PC draft** always remains available for supported drafts. Transfer the JSON file to your PC and use **Export → Create wallpaper → Open wallpaper draft**. It preserves the phone's screen dimensions; the PC monitor's dimensions do not replace them. Ordinary **Save draft** also supports this route. Link payloads are gzip-compressed where supported, stay in the URL fragment, and have a practical 12,000-character cap and 128 KiB decoded-data limit; larger designs use the JSON file (up to 4 MiB). Invalid/truncated links and oversized decompression are rejected before modifying a draft. The published web app must include this handoff version for link opening and wallpaper supersampling support.

**Video quality** offers Draft, Balanced, High, Ultra, Extreme, **Maximum · dynamic bitrate**, and a custom 0.5–600 Mbps target. Presets use the same quality levels as ordinary video export. Maximum requests minimum quantization in the browser; Android selects the codec's highest constant quality, or its highest advertised variable bitrate when constant quality is unavailable. This is device-dependent, not a guarantee of lossless encoding. The UI shows detected dimensions and the actual selected mode/bitrate before rendering. High-quality generated clips and package imports support up to 1 GiB per video and 3 GiB per package; manual Choose-video imports retain their 150 MB limit.

Steady editing, saved preview and exported clips share parameter rates and a palette clock. Saving mid-cycle preserves the baseline color/geometry relationship. Palette motion follows the parameter clock through cache warmup, pause, edits while paused, and resume, including full color laps beyond the shorter shape loop.

Legacy drafts without transition overrides remain readable and use the earlier global arrival duration, with the new fast-start default when rendered again. Select Slow start explicitly to recreate the old curve. Existing saved videos, including bundled samples, stay unchanged until you replace/render them.

While editing a **transition start**, parameter automation and color wandering are disabled: it is a still endpoint, and the transition curve defines its motion. Manual parameter values, sliders, precision controls, and color phase remain editable. Saved legacy motion is suppressed on a detached editing copy; Back preserves the saved design, while Save stores the start without ignored motion. Leaving start-scene editing restores the controls. **End / steady scenes** retain animation controls because they define the steady loops.

## Set up the inner and cover screens

On Samsung Fold, Home/lock destinations and inner/cover displays are separate choices. The setup guide shows which display is active and enables the appropriate step. Set the inner screen while open, then fold, wake/unlock the cover, reopen the app if needed, and set the cover. Choose Home and lock in each system preview when offered.

The inner step uses **Fractal Wallpaper**; the cover step uses the separately registered **Fractal Wallpaper · Cover** entry. This gives the picker another selectable component when it will not reapply the existing entry. Both entries share the gallery/media/preferences and remain adaptive to the actual display. If the direct preview has no Set button, the guide can open the public live wallpaper chooser; while folded, select the Cover entry there.

The app does not claim success merely because the picker returns. Check home and lock on both screens. Samsung ultimately controls wallpaper assignment; the new Cover entry is a public-API workaround and has **not been confirmed on the physical Fold**. There is no hidden Samsung API, overlay, Shizuku, or new permission involved.

Drafts persist in WebView/browser storage and can also be saved/opened as JSON. Drafts and package metadata support up to 4 MiB of UTF-8 JSON, including long exact constants and automation targets; metadata size is checked before video rendering. Custom formulas, custom constants, palettes, and parameter automation use the existing web renderer. In an ordinary desktop/mobile browser, the same editor downloads `fractal-wallpaper.zip`; transfer it to the phone and use **Wallpaper settings → Import wallpaper package**. Each new ZIP contains the selected screen's two MP4s, one poster, playback mapping and editable draft. Older combined seven-file packages remain accepted. Imported packages with an editor draft can now be reopened through **Wallpaper gallery → Edit design**; JSON **Save draft / Open wallpaper draft** also remains available for portable editing.

## Save and switch wallpapers

Completed renders and imported packages are automatically retained in the Android **Wallpaper gallery**, with a thumbnail, name, and storage size. Older retained packages from an existing installation also appear. There is no fixed entry limit; videos use phone storage until you delete them.

- **Wallpapers for → Main screen / Cover screen**, then **Use on main / cover**, changes only that screen. Older combined wallpapers appear in both lists. Playback preferences and active package/revision are separate per screen. Native **Wallpaper settings → Playback for** also changes only the selected screen.
- To rotate designs, check **Include in shuffle** on the desired gallery entries, then enable **Shuffle on each arrival**. Each screen has its own saved selection. A natural arrival chooses randomly and avoids the current design when another candidate exists; it plays the chosen design's own transition and loop. Lock/home engines share one choice for the same reveal. Returning after at least two seconds, initial display and fold events can trigger selection; resizing, picker previews and known external displays cannot. Arrival disabled or Battery Saver means no shuffle. The current screen's playback options apply to every pick. **Use only this**, or creating/importing a new design, switches that screen back to one fixed wallpaper while retaining its shuffle selection for later. Delete requires removing a design from any enabled shuffle selections first.
- **New wallpaper** starts a fresh design from the current explorer scene. **Edit design** loads the selected screen's saved pair; older combined designs are split without modifying the original. Both ask before replacing a working draft; use **Save draft** to keep unfinished edits. Rendering an edited design saves a new gallery entry and preserves the original.
- **Rename** changes the saved name. **Delete** asks before removing that entry's videos and design. Select another wallpaper on every screen using that design before deleting it.
- Packages made from individually chosen MP4s can be applied, renamed, and deleted, but have no fractal design to reopen. Each completed individual-clip import saves a new package while keeping older versions.
- **Restore sample videos** keeps the gallery intact. Gallery switching and new-package activation wait for pending native imports to finish.

The collection is private to this app on this phone. It survives normal restarts and compatible APK updates. Uninstalling or clearing app data removes it; a saved JSON draft backs up its editable design, not its rendered videos. The ordinary browser retains its existing draft/ZIP workflow and does not expose the Android gallery.

## Playback

- The bundled sample arrival lasts 2.8 seconds at 30 fps. Its idle loops last 8 seconds at 15 fps. The designer defaults to a 3-second arrival and an 8-second idle, with adjustable durations and 10–30 fps idle playback.
- The cover sample is 720 × 1680; the inner sample is 1080 × 1200. Both are silent H.264, generated on the computer with the existing fractal renderer. Video and poster textures are center-cropped to the wallpaper surface, including landscape.
- The arrival's final raw image exactly matches idle frame zero. Idle shape and palette motion return to their start without a deliberate hold or duplicate final frame. The compositor holds the matching steady poster while the idle decoder prepares, avoiding a black clear between clips. Each decoder has its own surface/texture queue, and retired frame callbacks cannot replace new artwork; actual handoff timing needs physical-device testing.
- Visibility or a change between the narrow cover display and the almost-square inner display triggers playback. The public display-mode dimensions identify the composition independently of a launcher's scrolling wallpaper surface. There is no sensor listener or system display override.
- Returning to the wallpaper after at least two seconds also plays the arrival. A shorter visibility bounce resumes with the idle loop. A fold detected while hidden still triggers the new screen's arrival.
- **Play arrival animation** and **After the transition** are independent settings. Choose **Still image · transitions only** to show the steady poster after an arrival and release the video decoder. Choose **Animated loop while visible** to enable idle motion. All four clips are retained, so this can be changed without rendering again. New packages carry this preference; older packages preserve the current phone setting.
- Hidden wallpapers and screen-off release the video decoder. Battery Saver suppresses animation and keeps a still image. GPU presentation happens on decoded-frame callbacks, with no continuous application render timer.
- Each wallpaper engine owns its player, surface, and graphics context. Concurrent preview, video-encoding, and display engines share a reference-counted EGL display. Fractal calculation runs only inside the foreground explorer and during wallpaper creation; playback uses decoded video frames.

## Your own artwork

The app's four **Choose…** buttons import MP4 clips from the Android document picker. The app copies them to private storage, so the original files can move afterward. Clips can be 0.5–60 seconds, up to 4096 pixels per side and 150 MB each. Sound is muted. Use **Restore sample videos** to return to the bundled artwork.

In the web explorer, use **Export video**, choose MP4, disable sound and set **Hold final frame** to 0 for an idle loop. Parameter animations can alter the shape; a complete color cycle provides inexpensive palette movement. Render a separate arrival that ends at the loop's starting view. Custom clips are not automatically joined or made seamless by the app. With no explicitly selected steady clip, each new arrival import updates its endpoint still image, including repeated imports and imports for the other screen. Selecting an idle clip makes its first frame the steady image.

For automatic arrival/idle pairs from the local renderer, edit [`demo-scenes.json`](demo-scenes.json), including each screen's final view, arrival starting parameters, idle parameter offsets, and palette:

```powershell
uv run python scripts/render_wallpaper.py
# Or keep a separate set:
uv run python scripts/render_wallpaper.py --settings my-scenes.json --output artifacts/my-wallpaper
```

Run these commands from the repository root. FFmpeg must be on PATH; the renderer uses CUDA when available, otherwise CPU. This tool supports the desktop renderer's five formulas and limits. The web app's additional/custom formulas can be exported to MP4 there and imported with the app's pickers. Generated media is excluded from Git and must be rendered before building.

## Build

The app has no third-party Android runtime dependencies. It bundles the web app and its existing dependencies and license notices. Install the web dependencies with `cd web; npm ci` first. Open this directory in Android Studio with SDK 36 and a compatible Gradle installation (AGP 8.10.1; Gradle 8.11.1+), render the sample assets, then build the app. Both builds run the production web build and include the resulting static files. Android 11 / API 30 is the minimum; Node's existing web requirements apply.

There is also a Windows build using only an installed JDK and the official SDK's platform/build tools, without Gradle:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File android/build.ps1 `
  -JavaHome 'C:\Program Files\Java\jdk-21' `
  -AndroidJar 'C:\path\to\Sdk\platforms\android-36\android.jar' `
  -BuildTools 'C:\path\to\Sdk\build-tools\36.0.0'
```

The script does not download tools. Its defaults use the workspace-local SDK archives prepared under `../artifacts/android-tools/`. It normalizes Windows aapt2 asset paths before signing, so nested browser assets work in Android's AssetManager. Build output and the development signing key stay under `../artifacts/android-wallpaper/`. Gradle and the Windows script create/reuse this same key. Keep that key for compatible updates; it is not a production signing key. Application ID: `org.fractalexplorer.wallpaper`.

Bundled resources are served under the pinned `https://appassets.androidplatform.net/explorer/` origin. External pages cannot navigate inside this privileged WebView. The narrow JavaScript bridge supports frame encoding, private staged packages, Android's document picker, and the wallpaper picker. Wallpaper exports use a native H.264 encoder with explicit frame timestamps; this also provides silent ordinary MP4 export when WebCodecs is missing (up to 4096 pixels / 16 MP, subject to advertised codec support; unsupported settings are rejected without changing their resolution or bitrate). Ordinary web MP4/soundscape exports retain their existing browser path when available. Renderer GPU availability depends on the installed WebView, with the existing WebAssembly worker fallback. APK updates update the bundled explorer; its browser service worker is intentionally bypassed inside Android.

## Verification and device testing

Version 0.9.0 adds phone-to-PC rendering via compressed links and JSON files, native sharing, and GPU/CPU feedback in the designer. Three fresh independent reviewers checked exact codec round trips, startup/navigation and asynchronous UI, and actual Chrome GPU exports back to Android-compatible ZIPs. Findings fixed include second-link navigation, stale replacement prompts, and slow validation of long trailing-zero decimals. All 283 web tests pass, along with 13 Python tests and six native host suites; instrumentation compiles. Real GPU exports cover native cover resolution at 2×/Maximum and above-native main resolution at 1.5×/custom bitrate. FFprobe and native host checks verify package contents, H.264 dimensions/timing and share dispatch. Physical Android chooser/import/playback still needs phone validation. Evidence: `../artifacts/android-wallpaper/review-report-0.9.0.json`.

Version 0.8.0 adds explicit inherited wallpaper supersampling and per-screen shuffle selections. All 271 web tests, 13 Python tests and six native host suites pass; Android instrumentation compiles. Three independent reviewers checked storage, playback and web behavior. Four findings were fixed and independently rechecked: queued revision rewinds, reversed lock/home reveal ordering, CPU fallback dimension validation, and disabling an enabled empty shuffle selection. Host audits pass 29 shuffle storage checks plus 55 prior storage checks, and 17 shuffle lifecycle checks plus 276 prior playback checks. Real Chrome checks cover exact downsampled pixels at all five sampling levels, crossfades, output dimensions and gallery controls. Android APIs/media are host fakes in those audits; physical Fold shuffle behavior remains untested. Evidence: `../artifacts/android-wallpaper/review-report-0.8.0.json`.

Version 0.7.1 adds six fresh independent reviews and follow-up checks after seven fixes. These cover export control locking, Gallery New native resolution, pause state after switching fractal families, imported color origins, MP4 finalization failures, concurrent playback choices attached to the outgoing artwork, and high-precision texture coordinates for native-resolution encoding/playback. The web suite passes 264 tests, with 13 Python tests and all five native host suites passing. Independent host audits check 17 encoder cases, 55 storage assertions and 387 playback/precision assertions. Native GPU precision is queried after making the EGL context current; large exports fail clearly if high-precision fragment floats are unavailable. The completed APK has not run on the physical Fold. Evidence: `../artifacts/android-wallpaper/review-report-0.7.1.json`.

Version 0.7.0 passed 262 web tests, 13 Python wallpaper tests, all five native host suites, and three fresh independent reviews with follow-up fixes. Review probes checked over 450,000 current/legacy samples, editor/save/preview phase fidelity, pause/resume, real Chrome high/Maximum H.264 output, exact screen dimensions, and 12 production native encoder capability cases with platform stubs. The APK and updated instrumentation compile; no physical Fold or device encoder execution was available. Evidence is listed in `../artifacts/android-wallpaper/review-report-0.7.0.json`.

Version 0.6.0 passed 257 web tests, 13 Python wallpaper tests, all five native host suites, and three fresh independent reviews with follow-up fixes. Real browser cover/main ZIP exports contain the expected two clips and poster; decoded transition endpoints match steady frame zero exactly. Native host checks cover independent selections/revisions/options, old combined packages, rollback and concurrent Settings choices. The instrumentation sources now create both screen designs separately and compile, but have not run on Android. Release evidence is listed in `../artifacts/android-wallpaper/review-report-0.6.0.json`.

Version 0.5.2 incorporates nine fresh independent reviews and follow-up checks after fixes. These covered scene editing, asynchronous imports, numerical paths, browser/GPU rendering, export cancellation, native storage transactions, and Android lifecycle behavior. Fixes include stale imports replacing newer work, hidden gallery errors, endpoint rounding and long-coordinate sampling, deep Python scene precision, publication/import races, late surface draws, false arrivals across displays, and graphics failures escaping clip callbacks. The current web suite has 250 passing tests, the wallpaper Python suite has 13, and the Windows build runs five native host suites. Additional host fault injection checks production renderer/service code with Android stubs; it does not replace device testing. Release details and evidence paths are recorded in `../artifacts/android-wallpaper/review-report-0.5.2.json`.

The Windows build compiles and runs the platform-independent lifecycle tests, then verifies the APK signature. Media verification checks actual encoded frames, dimensions, frame rates, absence of audio, handoff image differences, checksums, and uncompressed APK video assets:

```powershell
uv run pytest -q tests/test_wallpaper.py
uv run python android/tests/verify_media.py
```

The earlier player build was exercised in an Android 16 emulator: offline WebView startup, local fractal rendering, four native H.264 encodes, pixel/orientation checks, complete-package activation, and the actual native wallpaper preview. Browser integration checks cover mobile state editing, four-clip export, and an interoperable ZIP. The web tests also check deep decimal interpolation, endpoint matching, palettes, loops, and bridge transfers. Version 0.4.0 adds real mobile-browser gallery checks with a mocked Android bridge, including reload, exact draft restoration, narrow layouts, and the production Android Back script. Host Java tests cover failed preference commits and storage paths. The expanded instrumentation APK compiles, including gallery retention/switching/thumbnail/deletion/import checks, but the environment refused both hardware-accelerated and software emulator startup; the newer native callback/import/gallery regressions have not been executed on Android. Web/browser, host Java, media and signature checks run separately. It has **not been run on a physical Fold**, and no battery savings have been measured. On the SM-F976B / One UI 9.0, test:

1. Apply the wallpaper, open and close the phone on Home, and confirm the correct composition and one arrival per reveal.
2. Open an opaque app for several seconds, return Home, then lock/unlock. Check that a quick lock-to-home handoff does not replay the arrival unnecessarily.
3. Toggle idle motion and Battery Saver. Confirm that the image becomes still and resumes appropriately.
4. Test home and lock screens separately, landscape, cover-screen mirroring, and the phone's lock-when-folded preference. If the system keeps the new screen off, playback waits until it is shown.
5. Check **Settings → Battery** after normal use. If a clip cannot play, reopen the app for the last playback error.
6. Create at least three wallpapers, switch between them in **Wallpaper gallery**, restart the app, and confirm the collection persists. Rename, reopen a design, cancel New wallpaper, and delete an inactive entry. Change one wallpaper's playback options and confirm those return when selecting it again.

Samsung controls display activation, wallpaper visibility, and home/lock wallpaper selection. The app responds to those callbacks and cannot make an inactive display show an animation. There are no network, accessibility, overlay, sensor, or storage permissions in its manifest.

For emulator/device instrumentation, `android/tests/build-device-tests.ps1` builds a separate test APK with the same development certificate. Install both APKs on a disposable test device and run `adb shell am instrument -w -r org.fractalexplorer.wallpaper.tests/.SmokeInstrumentation`. The test clears that app's web storage, creates a small four-state wallpaper through the real editor, verifies activation/cancellation, compares decoded video pixels with the source posters, and exercises real arrival/idle/static playback on an Android surface. Static mode verifies that the player has been released and the exact poster is selected. Further checks cover Android 16 Back, abandoned-package cleanup, interrupted export recovery, individual-clip preservation/endpoint posters, synchronized controls, concurrent package imports, and delayed frame callbacks from a retired decoder. Successful or cancelled file saves release temporary files; interrupted registered copy jobs resume when the app next opens, subject to cache availability and document-provider permission. The test APK is not bundled into the delivered app.
