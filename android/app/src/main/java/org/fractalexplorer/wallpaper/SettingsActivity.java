package org.fractalexplorer.wallpaper;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Insets;
import android.media.MediaMetadataRetriever;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

public final class SettingsActivity extends Activity {
  private static final String[] SLOTS = {
    "cover-arrival", "cover-idle", "inner-arrival", "inner-idle"
  };
  private static final int PICK_VIDEO = 41;
  private static final int PICK_PACKAGE = 42;
  private static final int PICK_IMAGE = 43;
  private SharedPreferences preferences;
  private TextView status;
  private String pendingSlot;
  private String pendingImageScreen;
  private Button imagePicker;
  private final List<Button> importButtons = new ArrayList<>();
  private boolean importing;
  // Main-thread state shared across recreated/multiple settings activities.
  private static volatile boolean workRunning;
  private static String workStatus;
  private static final java.util.Set<SettingsActivity> visibleSettings = new java.util.HashSet<>();
  private RadioGroup steady;
  private RadioButton still, animated;
  private Switch arrivalSwitch;
  private String settingsScreen = "inner";
  private boolean syncingPlayback;
  private final SharedPreferences.OnSharedPreferenceChangeListener preferenceListener =
      (prefs, key) -> {
        if ("idle".equals(key) || (settingsScreen + "_idle").equals(key)) syncSteady();
        if ("arrival".equals(key) || (settingsScreen + "_arrival").equals(key)) syncArrival();
      };

  @Override
  public void onCreate(Bundle saved) {
    super.onCreate(saved);
    WallpaperFiles.recoverImportCache(getApplicationContext());
    setTitle("Wallpaper settings");
    preferences = getSharedPreferences("wallpaper", MODE_PRIVATE);
    if (saved != null) pendingSlot = saved.getString("pendingSlot");
    if (saved != null) pendingImageScreen = saved.getString("pendingImageScreen");
    if (saved != null) settingsScreen = saved.getString("settingsScreen", "inner");
    ScrollView scroll = new ScrollView(this);
    LinearLayout column = new LinearLayout(this);
    column.setOrientation(LinearLayout.VERTICAL);
    int gap = dp(20);
    column.setPadding(gap, gap, gap, gap);
    scroll.addView(column);
    setContentView(scroll);
    scroll.setOnApplyWindowInsetsListener(
        (view, insets) -> {
          Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
          column.setPadding(gap + bars.left, gap + bars.top, gap + bars.right, gap + bars.bottom);
          return insets;
        });
    text(column, "A little life behind your home screen.", 25);
    importButtons.add(
        button(
            column,
            "Wallpaper gallery",
            () ->
                startActivity(
                    new Intent(this, MainActivity.class)
                        .putExtra("wallpaper_gallery", true)
                        .addFlags(
                            Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP))));
    button(
        column,
        "Open Fractal Explorer",
        () ->
            startActivity(
                new Intent(this, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)));
    importButtons.add(
        button(
            column,
            "Import wallpaper package",
            () -> {
              Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
              intent.setType("*/*");
              intent.addCategory(Intent.CATEGORY_OPENABLE);
              startActivityForResult(intent, PICK_PACKAGE);
            }));
    text(
        column,
        "Open or close your Fold to reveal a short fractal animation. Then choose a still image or"
            + " a gentle loop.",
        16);
    button(
        column,
        "Set up on both screens",
        () -> {
          startActivity(new Intent(this, WallpaperSetupActivity.class));
        });
    text(column, "Playback for", 18);
    RadioGroup screens = new RadioGroup(this);
    RadioButton mainScreen = new RadioButton(this), coverScreen = new RadioButton(this);
    mainScreen.setId(View.generateViewId());
    coverScreen.setId(View.generateViewId());
    mainScreen.setText("Main screen");
    coverScreen.setText("Cover screen");
    screens.addView(mainScreen);
    screens.addView(coverScreen);
    screens.check("cover".equals(settingsScreen) ? coverScreen.getId() : mainScreen.getId());
    screens.setOnCheckedChangeListener(
        (group, checked) -> {
          settingsScreen = checked == coverScreen.getId() ? "cover" : "inner";
          syncSteady();
          syncArrival();
          syncImagePicker();
        });
    add(column, screens);
    imagePicker =
        button(
            column,
            "Import static image for "
                + ("cover".equals(settingsScreen) ? "cover" : "main")
                + " screen",
            () -> {
              pendingImageScreen = settingsScreen;
              Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
              intent.setType("image/*");
              intent.putExtra(
                  Intent.EXTRA_MIME_TYPES, new String[] {"image/png", "image/jpeg", "image/webp"});
              intent.addCategory(Intent.CATEGORY_OPENABLE);
              startActivityForResult(intent, PICK_IMAGE);
            });
    importButtons.add(imagePicker);
    text(
        column,
        "Static images can share a shuffle selection with animated wallpapers. Imported images are"
            + " center-cropped to this screen. The animation controls below apply to animated"
            + " entries.",
        14);
    arrivalSwitch = toggle(column, "Play arrival animation", "arrival");
    text(column, "After the transition", 18);
    steady = new RadioGroup(this);
    still = new RadioButton(this);
    still.setId(View.generateViewId());
    still.setText("Still image · transitions only");
    animated = new RadioButton(this);
    animated.setId(View.generateViewId());
    animated.setText("Animated loop while visible");
    steady.addView(still);
    steady.addView(animated);
    steady.check(
        WallpaperFiles.playback(preferences, settingsScreen, "idle")
            ? animated.getId()
            : still.getId());
    steady.setOnCheckedChangeListener(
        (group, checked) -> {
          if (!syncingPlayback)
            WallpaperGallery.queuePlayback(
                getApplicationContext(), settingsScreen + "_idle", checked == animated.getId());
        });
    add(column, steady);
    text(
        column,
        "Still image stops video playback after the transition. You can change this without"
            + " recreating the wallpaper.",
        14);
    text(
        column,
        "Playback stops when hidden or the screen is off. Battery Saver shows a still frame. A"
            + " quick lock-to-home handoff does not replay the arrival.",
        14);
    text(column, "Your own fractals", 21);
    text(
        column,
        "The sample is ready to use. You can replace each clip with an MP4 exported from Fractal"
            + " Explorer. Match the end of an arrival clip to the start of its idle loop for a"
            + " smooth handoff. Videos play silently.",
        15);
    String[] labels = {
      "Choose cover arrival",
      "Choose cover idle loop",
      "Choose inner arrival",
      "Choose inner idle loop"
    };
    for (int i = 0; i < SLOTS.length; i++) {
      final String slot = SLOTS[i];
      Button picker =
          button(
              column,
              labels[i],
              () -> {
                pendingSlot = slot;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.setType("video/mp4");
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivityForResult(intent, PICK_VIDEO);
              });
      importButtons.add(picker);
    }
    importButtons.add(
        button(
            column,
            "Restore sample videos",
            () -> {
              if (!beginWork("Restoring sample videos…")) return;
              File folder = new File(getFilesDir(), "videos");
              boolean okay = true;
              for (String slot : SLOTS) {
                File file = new File(folder, slot + ".mp4");
                if (file.exists() && !file.delete()) okay = false;
              }
              for (String prefix : new String[] {"cover", "inner"}) {
                File file = new File(folder, prefix + "-poster.png");
                if (file.exists() && !file.delete()) okay = false;
              }
              try {
                changed();
              } catch (Exception error) {
                finishWork(error.getMessage());
                return;
              }
              finishWork(
                  okay
                      ? "Sample videos restored."
                      : "Some files could not be restored. Try again.");
            }));
    status = text(column, "Pre-rendered artwork. No fractal calculation on your phone.", 14);
    String previousError = preferences.getString("last_error", "");
    if (!previousError.isEmpty()) status.setText("Last playback error: " + previousError);
  }

  private Switch toggle(LinearLayout column, String label, String key) {
    Switch control = new Switch(this);
    control.setText(label);
    control.setTextSize(17);
    control.setChecked(WallpaperFiles.playback(preferences, settingsScreen, key));
    add(column, control);
    control.setOnCheckedChangeListener(
        (button, checked) -> {
          if (!syncingPlayback)
            WallpaperGallery.queuePlayback(
                getApplicationContext(), settingsScreen + "_" + key, checked);
        });
    return control;
  }

  static boolean hasPendingChanges() {
    return workRunning;
  }

  private void changed() throws java.io.IOException {
    synchronized (WallpaperFiles.class) {
      SharedPreferences.Editor edit = preferences.edit();
      List<String> keys = new ArrayList<>();
      for (String screen : new String[] {"cover", "inner"}) {
        String previous = WallpaperFiles.activeId(preferences, screen);
        for (String key : new String[] {"idle", "arrival"}) {
          String savedKey = "gallery_" + screen + "_" + key + "_" + previous;
          if (PackPolicy.validId(previous)) {
            edit.putBoolean(savedKey, WallpaperFiles.playback(preferences, screen, key));
            keys.add(savedKey);
          }
        }
        edit.putString("active_" + screen, "")
            .putBoolean(screen + "_static", false)
            .putLong(screen + "_revision", WallpaperFiles.revision(preferences, screen) + 1);
        keys.add("active_" + screen);
        keys.add(screen + "_static");
        keys.add(screen + "_revision");
      }
      keys.add("active_pack");
      keys.add("last_error");
      WallpaperGallery.commit(
          preferences,
          edit.remove("active_pack").remove("last_error"),
          keys.toArray(new String[0]));
    }
  }

  private boolean beginWork(String message) {
    if (workRunning) {
      syncWork();
      return false;
    }
    workRunning = true;
    workStatus = message;
    syncWork();
    for (SettingsActivity screen : visibleSettings) screen.syncWork();
    return true;
  }

  private static void finishWork(String message) {
    workRunning = false;
    workStatus = message;
    for (SettingsActivity screen : visibleSettings) screen.syncWork();
  }

  private void syncWork() {
    importing = workRunning;
    for (Button button : importButtons) button.setEnabled(!workRunning);
    if (status != null && workStatus != null) status.setText(workStatus);
  }

  private int dp(int value) {
    return Math.round(value * getResources().getDisplayMetrics().density);
  }

  private void add(LinearLayout parent, View child) {
    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
    params.bottomMargin = dp(18);
    parent.addView(child, params);
  }

  private TextView text(LinearLayout column, String value, int size) {
    TextView label = new TextView(this);
    label.setText(value);
    label.setTextSize(size);
    add(column, label);
    return label;
  }

  private Button button(LinearLayout column, String label, Runnable action) {
    Button button = new Button(this);
    button.setText(label);
    button.setAllCaps(false);
    add(column, button);
    button.setOnClickListener(view -> action.run());
    return button;
  }

  @Override
  protected void onStart() {
    super.onStart();
    visibleSettings.add(this);
    syncWork();
    preferences.registerOnSharedPreferenceChangeListener(preferenceListener);
    syncSteady();
    syncArrival();
  }

  @Override
  protected void onStop() {
    visibleSettings.remove(this);
    preferences.unregisterOnSharedPreferenceChangeListener(preferenceListener);
    super.onStop();
  }

  private void syncSteady() {
    syncingPlayback = true;
    try {
      if (steady != null)
        steady.check(
            WallpaperFiles.playback(preferences, settingsScreen, "idle")
                ? animated.getId()
                : still.getId());
    } finally {
      syncingPlayback = false;
    }
  }

  private void syncArrival() {
    syncingPlayback = true;
    try {
      if (arrivalSwitch != null)
        arrivalSwitch.setChecked(WallpaperFiles.playback(preferences, settingsScreen, "arrival"));
    } finally {
      syncingPlayback = false;
    }
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (preferences != null && status != null) {
      String error = preferences.getString("last_error", "");
      if (!error.isEmpty()) status.setText("Last playback error: " + error);
    }
  }

  private void syncImagePicker() {
    if (imagePicker != null)
      imagePicker.setText(
          "Import static image for "
              + ("cover".equals(settingsScreen) ? "cover" : "main")
              + " screen");
  }

  @Override
  protected void onSaveInstanceState(Bundle state) {
    state.putString("pendingSlot", pendingSlot);
    state.putString("pendingImageScreen", pendingImageScreen);
    state.putString("settingsScreen", settingsScreen);
    super.onSaveInstanceState(state);
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request == PICK_IMAGE) {
      final String screen = pendingImageScreen;
      pendingImageScreen = null;
      if (result != RESULT_OK || data == null || data.getData() == null || screen == null) return;
      if (!beginWork("Importing static image…")) return;
      final android.net.Uri uri = data.getData();
      new Thread(
              () -> {
                String message;
                try {
                  String name = "Imported image";
                  try (android.database.Cursor cursor =
                      getContentResolver()
                          .query(
                              uri,
                              new String[] {android.provider.OpenableColumns.DISPLAY_NAME},
                              null,
                              null,
                              null)) {
                    if (cursor != null && cursor.moveToFirst()) {
                      String label = cursor.getString(0);
                      if (label != null) name = label;
                    }
                  } catch (Exception ignored) {
                  }
                  InputStream source = getContentResolver().openInputStream(uri);
                  if (source == null) throw new java.io.IOException("Cannot read this image");
                  StaticImageImporter.importImage(getApplicationContext(), source, screen, name);
                  message =
                      "Static image imported for "
                          + ("cover".equals(screen) ? "cover" : "main")
                          + " screen. Include it in shuffle from Wallpaper gallery.";
                } catch (Exception error) {
                  message = "Could not import image: " + error.getMessage();
                }
                final String text = message;
                runOnUiThread(() -> finishWork(text));
              },
              "Static wallpaper import")
          .start();
      return;
    }
    if (request == PICK_PACKAGE && result == RESULT_OK && data != null && data.getData() != null) {
      if (!beginWork("Importing wallpaper package…")) return;
      final android.net.Uri uri = data.getData();
      new Thread(
              () -> {
                String message;
                try {
                  InputStream source = getContentResolver().openInputStream(uri);
                  if (source == null) throw new java.io.IOException("Cannot open package");
                  new WallpaperFiles(this).importZip(source);
                  message = "Wallpaper imported. Preview & set wallpaper to use it.";
                } catch (Exception error) {
                  message = "Could not import wallpaper: " + error.getMessage();
                }
                final String text = message;
                runOnUiThread(() -> finishWork(text));
              },
              "Wallpaper package import")
          .start();
      return;
    }
    if (request != PICK_VIDEO
        || result != RESULT_OK
        || data == null
        || data.getData() == null
        || pendingSlot == null) return;
    final String slot = pendingSlot;
    pendingSlot = null;
    if (!beginWork("Preparing your video…")) return;
    final android.net.Uri uri = data.getData();
    new Thread(
            () -> {
              File folder = new File(getCacheDir(), "clip-imports");
              String jobId = WallpaperFiles.newId();
              File temporary = new File(folder, jobId + ".mp4");
              File poster = new File(folder, jobId + ".png");
              String message;
              try {
                if (!folder.isDirectory() && !folder.mkdirs())
                  throw new java.io.IOException("Cannot create video folder");
                try (InputStream source = getContentResolver().openInputStream(uri);
                    FileOutputStream target = new FileOutputStream(temporary)) {
                  if (source == null) throw new java.io.IOException("Cannot read this video");
                  byte[] buffer = new byte[65536];
                  int count;
                  long total = 0;
                  while ((count = source.read(buffer)) != -1) {
                    total += count;
                    if (total > 150L * 1024 * 1024)
                      throw new java.io.IOException("Choose a video under 150 MB");
                    target.write(buffer, 0, count);
                  }
                }
                try (MediaMetadataRetriever metadata = new MediaMetadataRetriever()) {
                  metadata.setDataSource(temporary.getAbsolutePath());
                  long duration =
                      Long.parseLong(
                          metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
                  int width =
                      Integer.parseInt(
                          metadata.extractMetadata(
                              MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
                  int height =
                      Integer.parseInt(
                          metadata.extractMetadata(
                              MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
                  if (duration < 500
                      || duration > 60000
                      || width <= 0
                      || height <= 0
                      || Math.max(width, height) > 4096)
                    throw new java.io.IOException(
                        "Choose a 0.5–60 second video, up to 4096 pixels per side");
                  float scale = Math.min(1, 1280f / Math.max(width, height));
                  Bitmap image =
                      metadata.getScaledFrameAtTime(
                          slot.endsWith("arrival") ? Math.max(0, duration * 1000 - 1) : 0,
                          slot.endsWith("arrival")
                              ? MediaMetadataRetriever.OPTION_CLOSEST
                              : MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
                          Math.max(1, Math.round(width * scale)),
                          Math.max(1, Math.round(height * scale)));
                  if (image == null)
                    throw new java.io.IOException("No playable video frames found");
                  try (FileOutputStream target = new FileOutputStream(poster)) {
                    if (!image.compress(Bitmap.CompressFormat.PNG, 100, target))
                      throw new java.io.IOException("Cannot save video poster");
                  } finally {
                    image.recycle();
                  }
                }
                new WallpaperFiles(this).replaceVideo(slot, temporary, poster);
                message = "Video saved. Open the wallpaper preview to see it.";
              } catch (Exception error) {
                message = "Could not import: " + error.getMessage();
              } finally {
                if (temporary.exists()) temporary.delete();
                if (poster.exists()) poster.delete();
              }
              final String completed = message;
              runOnUiThread(() -> finishWork(completed));
            },
            "Wallpaper import")
        .start();
  }
}
