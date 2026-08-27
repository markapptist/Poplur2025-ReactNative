package com.apptist.poplur2025.reactnative

import android.app.Activity
import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class PoplurSafeBrowserModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private var pendingPromise: Promise? = null

  private val activityListener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(
      activity: Activity,
      requestCode: Int,
      resultCode: Int,
      data: Intent?,
    ) {
      if (requestCode != REQUEST_CODE) return
      pendingPromise?.resolve(null)
      pendingPromise = null
    }
  }

  init {
    reactContext.addActivityEventListener(activityListener)
  }

  override fun getName(): String = "PoplurSafeBrowser"

  @ReactMethod
  fun open(candidate: String?, promise: Promise) {
    val safeUrl = normalizePoplurSafeBrowserUrl(candidate)
    if (safeUrl == null) {
      promise.reject("E_BROWSER_URL", "Poplur only opens credential-free HTTPS addresses.")
      return
    }
    if (pendingPromise != null) {
      promise.reject("E_BROWSER_OPEN", "The Poplur Browser is already open.")
      return
    }
    val activity = currentActivity
    if (activity == null) {
      promise.reject("E_BROWSER_ACTIVITY", "Poplur is not ready to open the browser.")
      return
    }

    pendingPromise = promise
    try {
      val browserActivity = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        PoplurSafeBrowserActivity::class.java
      } else {
        PoplurSafeBrowserLegacyActivity::class.java
      }
      activity.startActivityForResult(
        Intent(activity, browserActivity)
          .putExtra(PoplurSafeBrowserActivity.EXTRA_URL, safeUrl),
        REQUEST_CODE,
      )
    } catch (error: Throwable) {
      pendingPromise = null
      promise.reject("E_BROWSER_OPEN", "The Poplur Browser could not be opened.", error)
    }
  }

  override fun invalidate() {
    reactContext.removeActivityEventListener(activityListener)
    pendingPromise?.reject("E_BROWSER_CLOSED", "The Poplur Browser host closed.")
    pendingPromise = null
    super.invalidate()
  }

  private companion object {
    const val REQUEST_CODE = 0x5042
  }
}
