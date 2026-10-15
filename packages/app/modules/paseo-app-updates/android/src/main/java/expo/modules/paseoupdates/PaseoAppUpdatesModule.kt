package expo.modules.paseoupdates

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class PaseoAppUpdatesModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext)
  private val apk get() = File(context.cacheDir, "paseo-updates/update.apk")
  private var verifiedVersion: Long? = null
  private var verifiedDigest: String? = null

  override fun definition() = ModuleDefinition {
    Name("PaseoAppUpdates")
    Events("downloadProgress")

    Function("getInstalledVersionCode") {
      context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode.toDouble()
    }

    AsyncFunction("downloadAsync") { url: String, digest: String, size: Long, version: Long ->
      try {
        require(digest.matches(Regex("[a-f0-9]{64}"))) { "Invalid SHA256" }
        require(size in 1..524288000) { "Invalid APK size" }
        val source = Uri.parse(url)
        require(source.scheme == "https" && source.host == "github.com" &&
          source.path.orEmpty().startsWith("/finelly977/paseo/releases/download/") &&
          source.userInfo == null) { "Untrusted APK source" }
        verifiedVersion = null
        verifiedDigest = null
        val directory = requireNotNull(apk.parentFile)
        require(directory.isDirectory || directory.mkdirs()) { "Cannot create APK cache" }
        val connection = openDownload(URL(url))
        try {
          require(connection.responseCode == 200) { "Download HTTP ${connection.responseCode}" }
          connection.inputStream.use { input ->
            apk.outputStream().use { output ->
              val buffer = ByteArray(65536)
              var received = 0L
              var lastProgress = -1
              while (true) {
                val count = input.read(buffer)
                if (count == -1) break
                received += count
                require(received <= size) { "APK exceeds declared size" }
                output.write(buffer, 0, count)
                val progress = (received * 100 / size).toInt()
                if (progress != lastProgress) {
                  lastProgress = progress
                  sendEvent("downloadProgress", mapOf("percent" to progress))
                }
              }
              require(received == size) { "Incomplete APK download" }
            }
          }
        } finally {
          connection.disconnect()
        }
        validateApk(digest, version)
        verifiedVersion = version
        verifiedDigest = digest
      } catch (error: Exception) {
        Log.e("PaseoAppUpdates", "APK download or validation failed", error)
        if (apk.exists() && !apk.delete()) Log.e("PaseoAppUpdates", "Cannot remove invalid APK")
        throw error
      }
    }

    AsyncFunction("installAsync") {
      try {
        validateApk(requireNotNull(verifiedDigest), requireNotNull(verifiedVersion))
        if (!context.packageManager.canRequestPackageInstalls()) {
          context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          "permission-required"
        } else {
          val uri = FileProvider.getUriForFile(context, "${context.packageName}.paseo-updates", apk)
          context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri,
            "application/vnd.android.package-archive").addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION))
          "installer-opened"
        }
      } catch (error: Exception) {
        Log.e("PaseoAppUpdates", "Cannot open APK installer", error)
        throw error
      }
    }
  }

  private fun openDownload(url: URL, redirects: Int = 0): HttpURLConnection {
    require(redirects <= 5 && url.protocol == "https" && url.userInfo == null &&
      url.host in setOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com")) {
      "Untrusted download redirect"
    }
    val connection = url.openConnection() as HttpURLConnection
    connection.instanceFollowRedirects = false
    connection.connectTimeout = 30000
    connection.readTimeout = 60000
    connection.setRequestProperty("User-Agent", "Paseo-Android-Updater")
    if (connection.responseCode in setOf(301, 302, 303, 307, 308)) {
      val location = requireNotNull(connection.getHeaderField("Location"))
      connection.disconnect()
      return openDownload(URL(url, location), redirects + 1)
    }
    return connection
  }

  @Suppress("DEPRECATION")
  private fun validateApk(digest: String, version: Long) {
    val sha = MessageDigest.getInstance("SHA-256")
    apk.inputStream().use { input ->
      val buffer = ByteArray(65536)
      while (true) {
        val count = input.read(buffer)
        if (count == -1) break
        sha.update(buffer, 0, count)
      }
    }
    require(sha.digest().joinToString("") { "%02x".format(it) } == digest) { "APK SHA256 mismatch" }
    val manager = context.packageManager
    val archive = requireNotNull(manager.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNING_CERTIFICATES))
    val installed = manager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
    require(archive.packageName == context.packageName) { "APK package mismatch" }
    require(archive.longVersionCode == version && version > installed.longVersionCode) { "APK version mismatch or downgrade" }
    val archiveSigners = requireNotNull(archive.signingInfo).apkContentsSigners.toSet()
    val installedSigners = requireNotNull(installed.signingInfo).apkContentsSigners.toSet()
    require(archiveSigners == installedSigners && archiveSigners.isNotEmpty()) { "APK signer mismatch" }
  }
}
