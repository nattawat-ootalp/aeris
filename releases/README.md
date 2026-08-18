# Release builds

Binaries kept in the repository at the project owner's request.

`NextAir-1.4.2-BKK-TRT-003.apk` — Android build of the Expo app, signed with the **debug
keystore**, so it sideloads (Settings → install from unknown sources) but cannot go to the Play
Store. Built at partition of the app's own history: it points at
`https://aeris-core-api.onrender.com` and defaults to device `BKK-TRT-003`.

It does not contain the Analyse screens (route exposure simulator, time machine). Those are
web-only by design and live at `/analyse/simulator` and `/analyse/time-machine`.

## A note on keeping binaries here

Git stores every version of a file forever, so an 84 MB APK adds 84 MB to every clone of this
repository permanently — deleting it later does not reclaim the space, because the old blob
stays in history. GitHub also warns above 50 MB and refuses above 100 MB, which this is
approaching.

The alternative that costs the repository nothing is a **GitHub Release**: same file, same URL
to share, attached to a tag rather than committed. Worth moving to if more builds follow.

Rebuild from source instead of adding another APK here:

```
cd mobile
npx expo prebuild --clean --platform android
cd android && ./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```
