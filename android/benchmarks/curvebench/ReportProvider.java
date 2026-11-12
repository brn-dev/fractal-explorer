package org.fractalexplorer.curvebench;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Read-only, explicitly granted sharing of one immutable report; no arbitrary paths. */
public final class ReportProvider extends ContentProvider {
  public static final String AUTHORITY = "org.fractalexplorer.curvebench.reports";

  public static Uri uri(String name) {
    if (!valid(name)) throw new IllegalArgumentException("Invalid report name");
    return new Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(name).build();
  }

  private static boolean valid(String name) {
    return name != null && name.matches("report-[0-9a-f]{32}\\.json");
  }

  private File file(Uri uri) throws FileNotFoundException {
    String name = uri.getLastPathSegment();
    if (!AUTHORITY.equals(uri.getAuthority())
        || uri.getPathSegments().size() != 1
        || !valid(name)
        || uri.getQuery() != null) throw new FileNotFoundException("Unknown report");
    File file = new File(new File(getContext().getFilesDir(), "reports"), name);
    if (!file.isFile()) throw new FileNotFoundException("Report unavailable");
    return file;
  }

  @Override
  public boolean onCreate() {
    return true;
  }

  @Override
  public String getType(Uri uri) {
    return "application/json";
  }

  @Override
  public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
    if (!"r".equals(mode)) throw new FileNotFoundException("Reports are read-only");
    return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
  }

  @Override
  public Cursor query(
      Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
    try {
      File file = file(uri);
      String[] names =
          projection == null
              ? new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}
              : projection;
      MatrixCursor cursor = new MatrixCursor(names);
      Object[] row = new Object[names.length];
      for (int i = 0; i < names.length; i++)
        row[i] =
            OpenableColumns.DISPLAY_NAME.equals(names[i])
                ? file.getName()
                : OpenableColumns.SIZE.equals(names[i]) ? file.length() : null;
      cursor.addRow(row);
      return cursor;
    } catch (FileNotFoundException e) {
      return null;
    }
  }

  @Override
  public Uri insert(Uri uri, ContentValues values) {
    throw new UnsupportedOperationException("Read only");
  }

  @Override
  public int delete(Uri uri, String selection, String[] args) {
    throw new UnsupportedOperationException("Read only");
  }

  @Override
  public int update(Uri uri, ContentValues values, String selection, String[] args) {
    throw new UnsupportedOperationException("Read only");
  }
}
