package com.apptist.poplur2025.reactnative

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.ClientCertRequest
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.HttpAuthHandler
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import java.util.concurrent.atomic.AtomicBoolean

private const val MAX_POPLUR_BROWSER_URL_LENGTH = 2048

internal fun normalizePoplurSafeBrowserUrl(value: String?): String? {
  if (value.isNullOrBlank() || value.length > MAX_POPLUR_BROWSER_URL_LENGTH) return null
  return try {
    val uri = Uri.parse(value)
    if (!uri.scheme.equals("https", ignoreCase = true)
      || uri.host.isNullOrBlank()
      || uri.encodedUserInfo != null) {
      null
    } else {
      uri.toString()
    }
  } catch (_: Throwable) {
    null
  }
}

open class PoplurSafeBrowserActivity : Activity() {
  private lateinit var webView: WebView
  private lateinit var hostLabel: TextView
  private lateinit var progress: ProgressBar
  private lateinit var errorPanel: LinearLayout
  private var disposed = false
  private var previousAcceptCookie: Boolean? = null

  protected open val usesIsolatedWebViewProfile: Boolean = true

  override fun onCreate(savedInstanceState: Bundle?) {
    if (usesIsolatedWebViewProfile
      && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
      && dataDirectoryConfigured.compareAndSet(false, true)) {
      try {
        // This Activity runs in :poplur_external_browser, so its WebView data
        // directory and CookieManager cannot touch the signed-in Home process.
        WebView.setDataDirectorySuffix("poplur_external_browser")
      } catch (_: IllegalStateException) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)
        finish()
        return
      }
    }

    super.onCreate(savedInstanceState)
    window.statusBarColor = Color.rgb(33, 8, 23)
    window.navigationBarColor = Color.rgb(21, 4, 15)

    val safeUrl = normalizePoplurSafeBrowserUrl(intent.getStringExtra(EXTRA_URL))
    if (safeUrl == null) {
      setResult(RESULT_CANCELED)
      finish()
      return
    }

    buildInterface()
    configureWebView()
    loadInitialUrl(safeUrl)
  }

  @Deprecated("Deprecated in Android")
  override fun onBackPressed() {
    if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else finishBrowser()
  }

  override fun onDestroy() {
    disposed = true
    if (::webView.isInitialized) {
      webView.stopLoading()
      webView.onPause()
      webView.clearFormData()
      if (usesIsolatedWebViewProfile) {
        // API 28+ first-party cookies/storage are session-only inside the
        // dedicated suffix/process and are purged before that surface closes.
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        WebStorage.getInstance().deleteAllData()
        webView.clearCache(true)
        webView.clearHistory()
      }
      webView.removeAllViews()
      webView.destroy()
    }
    previousAcceptCookie?.let { CookieManager.getInstance().setAcceptCookie(it) }
    previousAcceptCookie = null
    super.onDestroy()
  }

  private fun buildInterface() {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.rgb(21, 4, 15))
    }
    val toolbar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(8), 0, dp(8), 0)
      setBackgroundColor(Color.rgb(33, 8, 23))
    }

    val back = toolbarButton("‹  Back").apply {
      contentDescription = "Back in browser"
      setOnClickListener {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else finishBrowser()
      }
    }
    toolbar.addView(back, LinearLayout.LayoutParams(dp(82), dp(56)))

    val location = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
    }
    location.addView(TextView(this).apply {
      text = "POPLUR BROWSER"
      setTextColor(Color.rgb(255, 98, 177))
      textSize = 11f
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      letterSpacing = 0.14f
      gravity = Gravity.CENTER
    })
    hostLabel = TextView(this).apply {
      setTextColor(Color.WHITE)
      textSize = 13f
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      gravity = Gravity.CENTER
      maxLines = 1
    }
    location.addView(hostLabel)
    toolbar.addView(location, LinearLayout.LayoutParams(0, dp(56), 1f))

    val done = toolbarButton("Done").apply {
      contentDescription = "Done"
      setOnClickListener { finishBrowser() }
    }
    toolbar.addView(done, LinearLayout.LayoutParams(dp(72), dp(56)))
    root.addView(toolbar, LinearLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      dp(64),
    ))

    val surface = FrameLayout(this).apply { setBackgroundColor(Color.WHITE) }
    webView = WebView(this)
    surface.addView(webView, FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT,
    ))
    progress = ProgressBar(this).apply { visibility = View.VISIBLE }
    surface.addView(progress, FrameLayout.LayoutParams(dp(48), dp(48), Gravity.CENTER))

    errorPanel = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      visibility = View.GONE
      setPadding(dp(36), dp(20), dp(36), dp(20))
      setBackgroundColor(Color.rgb(255, 245, 250))
      addView(TextView(this@PoplurSafeBrowserActivity).apply {
        text = "This page could not be opened."
        setTextColor(Color.rgb(33, 8, 23))
        textSize = 22f
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        gravity = Gravity.CENTER
      })
      addView(TextView(this@PoplurSafeBrowserActivity).apply {
        text = "Poplur only opens secure HTTPS pages inside its private browser."
        setTextColor(Color.rgb(117, 88, 106))
        textSize = 15f
        gravity = Gravity.CENTER
        setPadding(0, dp(12), 0, dp(20))
      })
      addView(toolbarButton("Back to Poplur").apply {
        setTextColor(Color.WHITE)
        background = GradientDrawable().apply {
          cornerRadius = dp(18).toFloat()
          setColor(Color.rgb(229, 29, 130))
        }
        setOnClickListener { finishBrowser() }
      }, LinearLayout.LayoutParams(dp(180), dp(52)))
    }
    surface.addView(errorPanel, FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT,
    ))

    root.addView(surface, LinearLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      0,
      1f,
    ))
    setContentView(root)
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun configureWebView() {
    val cookieManager = CookieManager.getInstance()
    if (!usesIsolatedWebViewProfile) previousAcceptCookie = cookieManager.acceptCookie()
    // API 28+ can keep first-party cookies for carts/consent/redirects during
    // this visit because they live only in its suffix/process and are purged
    // on destroy. API 24–27 stays in-process and therefore sends/accepts none
    // while the parked Home WebView is covered.
    cookieManager.setAcceptCookie(usesIsolatedWebViewProfile)
    cookieManager.setAcceptThirdPartyCookies(webView, false)
    webView.settings.apply {
      javaScriptEnabled = true
      javaScriptCanOpenWindowsAutomatically = false
      setSupportMultipleWindows(true)
      domStorageEnabled = usesIsolatedWebViewProfile
      databaseEnabled = false
      allowFileAccess = false
      allowContentAccess = false
      cacheMode = WebSettings.LOAD_NO_CACHE
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      setGeolocationEnabled(false)
      mediaPlaybackRequiresUserGesture = true
      saveFormData = false
      userAgentString = "${userAgentString.orEmpty()} PoplurBrowser/1.0".trim()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) safeBrowsingEnabled = true
    }
    webView.removeJavascriptInterface("searchBoxJavaBridge_")
    webView.removeJavascriptInterface("accessibility")
    webView.removeJavascriptInterface("accessibilityTraversal")
    webView.setDownloadListener { _, _, _, _, _ -> Unit }

    webView.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        return normalizePoplurSafeBrowserUrl(request.url.toString()) == null
      }

      @Deprecated("Deprecated in Android")
      override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
        return normalizePoplurSafeBrowserUrl(url) == null
      }

      override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        val safeUrl = normalizePoplurSafeBrowserUrl(url)
        if (safeUrl == null) {
          view.stopLoading()
          return
        }
        updateAllowedLocation(safeUrl)
        errorPanel.visibility = View.GONE
        progress.visibility = View.VISIBLE
      }

      override fun onPageFinished(view: WebView, url: String?) {
        val safeUrl = normalizePoplurSafeBrowserUrl(url) ?: return
        updateAllowedLocation(safeUrl)
        progress.visibility = View.GONE
      }

      override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError,
      ) {
        if (request.isForMainFrame) showFailure(request.url.toString())
      }

      override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        handler.cancel()
        showFailure(error.url)
      }

      override fun onReceivedHttpAuthRequest(
        view: WebView,
        handler: HttpAuthHandler,
        host: String,
        realm: String,
      ) {
        handler.cancel()
      }

      override fun onReceivedClientCertRequest(view: WebView, request: ClientCertRequest) {
        request.cancel()
      }

      override fun onRenderProcessGone(
        view: WebView,
        detail: android.webkit.RenderProcessGoneDetail,
      ): Boolean {
        showFailure(view.url)
        return true
      }
    }

    webView.webChromeClient = object : WebChromeClient() {
      override fun onPermissionRequest(request: PermissionRequest) {
        // This denial is native and unconditional even when Poplur itself has
        // already received CAMERA or RECORD_AUDIO permission from the user.
        request.deny()
      }

      override fun onGeolocationPermissionsShowPrompt(
        origin: String,
        callback: GeolocationPermissions.Callback,
      ) {
        callback.invoke(origin, false, false)
      }

      override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams,
      ): Boolean {
        filePathCallback.onReceiveValue(null)
        return true
      }

      override fun onCreateWindow(
        view: WebView,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message,
      ): Boolean {
        if (!isUserGesture || disposed) return false
        val catcher = WebView(this@PoplurSafeBrowserActivity).apply {
          settings.javaScriptEnabled = false
          settings.allowFileAccess = false
          settings.allowContentAccess = false
          settings.domStorageEnabled = false
          settings.cacheMode = WebSettings.LOAD_NO_CACHE
          settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        var handled = false
        fun capture(candidate: String?) {
          if (handled) return
          handled = true
          val safeUrl = normalizePoplurSafeBrowserUrl(candidate)
          if (safeUrl != null && !disposed) webView.loadUrl(safeUrl)
          catcher.stopLoading()
          catcher.destroy()
        }
        catcher.webViewClient = object : WebViewClient() {
          override fun shouldOverrideUrlLoading(
            popup: WebView,
            request: WebResourceRequest,
          ): Boolean {
            capture(request.url.toString())
            return true
          }

          @Deprecated("Deprecated in Android")
          override fun shouldOverrideUrlLoading(popup: WebView, url: String): Boolean {
            capture(url)
            return true
          }

          override fun onPageStarted(popup: WebView, url: String?, favicon: Bitmap?) {
            capture(url)
          }
        }
        val transport = resultMsg.obj as? WebView.WebViewTransport ?: run {
          catcher.destroy()
          return false
        }
        transport.webView = catcher
        resultMsg.sendToTarget()
        return true
      }
    }
  }

  private fun updateAllowedLocation(safeUrl: String) {
    val host = Uri.parse(safeUrl).host ?: return
    hostLabel.text = "🔒 $host"
  }

  private fun loadInitialUrl(safeUrl: String) {
    if (!usesIsolatedWebViewProfile) {
      webView.loadUrl(safeUrl)
      return
    }
    // Recover cleanly even if Android killed the previous browser process
    // before Activity.onDestroy could run its normal session cleanup.
    WebStorage.getInstance().deleteAllData()
    webView.clearCache(true)
    CookieManager.getInstance().removeAllCookies {
      webView.post {
        if (!disposed) webView.loadUrl(safeUrl)
      }
    }
  }

  private fun showFailure(candidate: String?) {
    val safeUrl = normalizePoplurSafeBrowserUrl(candidate) ?: return
    updateAllowedLocation(safeUrl)
    progress.visibility = View.GONE
    errorPanel.visibility = View.VISIBLE
  }

  private fun finishBrowser() {
    setResult(RESULT_OK)
    finish()
  }

  private fun toolbarButton(label: String): TextView = TextView(this).apply {
    text = label
    setTextColor(Color.rgb(255, 98, 177))
    textSize = 16f
    typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    gravity = Gravity.CENTER
    isClickable = true
    isFocusable = true
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  companion object {
    const val EXTRA_URL = "poplur.browser.url"
    private val dataDirectoryConfigured = AtomicBoolean(false)
  }
}

/**
 * Android 7–8.1 has no WebView data-directory suffix API. Running a WebView in
 * a second process there can contend for Home's profile lock, so this fallback
 * deliberately stays in the main process with all storage/cookies disabled
 * while the already-parked Home WebView is covered.
 */
class PoplurSafeBrowserLegacyActivity : PoplurSafeBrowserActivity() {
  override val usesIsolatedWebViewProfile: Boolean = false
}
