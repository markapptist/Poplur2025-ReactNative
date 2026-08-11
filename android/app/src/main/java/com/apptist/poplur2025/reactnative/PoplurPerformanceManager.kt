package com.apptist.poplur2025.reactnative

import android.app.ActivityManager
import android.app.Application
import android.content.BroadcastReceiver
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import java.lang.ref.WeakReference
import java.util.Collections
import java.util.WeakHashMap
import kotlin.math.max

object PoplurPerformanceManager : ComponentCallbacks2 {
  enum class Mode { FULL, REDUCED, LOW_POWER, EMERGENCY }
  enum class MemoryPressure { NORMAL, WARNING, CRITICAL }

  interface Observer {
    fun onPoplurPerformanceChanged()
  }

  private const val MIB = 1024L * 1024L
  private val observers = Collections.newSetFromMap(WeakHashMap<Observer, Boolean>())
  private val handler = Handler(Looper.getMainLooper())
  private var application: Application? = null
  private var powerManager: PowerManager? = null
  private var activeHeavyRenderer = WeakReference<Any>(null)
  private var activeHeavyRendererIdentifier: String? = null
  private var thermalStatus = PowerManager.THERMAL_STATUS_NONE
  private var memoryPressureGeneration = 0

  var mode: Mode = Mode.FULL
    private set
  var memoryPressure: MemoryPressure = MemoryPressure.NORMAL
    private set
  var memoryWarningCount: Int = 0
    private set
  var appActive: Boolean = false
    private set
  var baseCacheBudgetBytes: Long = 300L * MIB
    private set

  val targetFramesPerSecond: Int
    get() = when (mode) {
      Mode.FULL -> 30
      Mode.REDUCED -> 24
      Mode.LOW_POWER -> 15
      Mode.EMERGENCY -> 10
    }

  val particleDensityMultiplier: Float
    get() = when (mode) {
      Mode.FULL -> 1f
      Mode.REDUCED -> 0.5f
      Mode.LOW_POWER -> 0.25f
      Mode.EMERGENCY -> 0f
    }

  val particlesAllowed: Boolean
    get() = mode != Mode.EMERGENCY

  private val powerSaveReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      recomputeMode()
    }
  }

  private val thermalListener = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
    PowerManager.OnThermalStatusChangedListener { status ->
      thermalStatus = status
      recomputeMode()
    }
  } else null

  @Synchronized
  fun initialize(app: Application) {
    if (application != null) return
    application = app
    powerManager = app.getSystemService(Context.POWER_SERVICE) as PowerManager
    val activityManager = app.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    baseCacheBudgetBytes = when {
      activityManager.memoryClass <= 192 -> 150L * MIB
      activityManager.memoryClass <= 384 -> 300L * MIB
      else -> 450L * MIB
    }
    app.registerComponentCallbacks(this)
    val filter = IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      app.registerReceiver(powerSaveReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      app.registerReceiver(powerSaveReceiver, filter)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      thermalStatus = powerManager?.currentThermalStatus ?: PowerManager.THERMAL_STATUS_NONE
      thermalListener?.let { powerManager?.addThermalStatusListener(app.mainExecutor, it) }
    }
    recomputeMode()
  }

  fun addObserver(observer: Observer) {
    observers.add(observer)
  }

  fun removeObserver(observer: Observer) {
    observers.remove(observer)
  }

  fun setAppActive(active: Boolean) {
    if (appActive == active) return
    appActive = active
    if (!active) {
      activeHeavyRenderer.clear()
      activeHeavyRendererIdentifier = null
    }
    notifyObservers()
  }

  @Synchronized
  fun acquireHeavyRenderer(owner: Any, identifier: String, decorative: Boolean): Boolean {
    if (!appActive || (decorative && mode == Mode.EMERGENCY)) return false
    val current = activeHeavyRenderer.get()
    if (current != null && current !== owner) return false
    activeHeavyRenderer = WeakReference(owner)
    activeHeavyRendererIdentifier = identifier
    return true
  }

  @Synchronized
  fun releaseHeavyRenderer(owner: Any) {
    if (activeHeavyRenderer.get() !== owner) return
    activeHeavyRenderer.clear()
    activeHeavyRendererIdentifier = null
    notifyObservers()
  }

  override fun onTrimMemory(level: Int) {
    when {
      level == ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN -> setAppActive(false)
      level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE -> setMemoryPressure(MemoryPressure.CRITICAL)
      level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW -> setMemoryPressure(MemoryPressure.WARNING)
    }
  }

  override fun onLowMemory() {
    setMemoryPressure(MemoryPressure.CRITICAL)
  }

  override fun onConfigurationChanged(newConfig: Configuration) = Unit

  private fun setMemoryPressure(pressure: MemoryPressure) {
    memoryWarningCount += 1
    memoryPressure = pressure
    val generation = ++memoryPressureGeneration
    recomputeMode()
    handler.postDelayed({
      if (memoryPressureGeneration != generation) return@postDelayed
      memoryPressure = MemoryPressure.NORMAL
      recomputeMode()
    }, 30_000)
  }

  private fun recomputeMode() {
    val thermalMode = when (thermalStatus) {
      PowerManager.THERMAL_STATUS_MODERATE -> Mode.REDUCED
      PowerManager.THERMAL_STATUS_SEVERE -> Mode.LOW_POWER
      PowerManager.THERMAL_STATUS_CRITICAL,
      PowerManager.THERMAL_STATUS_EMERGENCY,
      PowerManager.THERMAL_STATUS_SHUTDOWN -> Mode.EMERGENCY
      else -> Mode.FULL
    }
    val powerMode = if (powerManager?.isPowerSaveMode == true) Mode.LOW_POWER else Mode.FULL
    val memoryMode = when (memoryPressure) {
      MemoryPressure.NORMAL -> Mode.FULL
      MemoryPressure.WARNING -> Mode.LOW_POWER
      MemoryPressure.CRITICAL -> Mode.EMERGENCY
    }
    val nextMode = Mode.values()[max(thermalMode.ordinal, max(powerMode.ordinal, memoryMode.ordinal))]
    val previous = mode
    mode = nextMode
    if (nextMode == Mode.EMERGENCY) {
      activeHeavyRenderer.clear()
      activeHeavyRendererIdentifier = null
    }
    if (BuildConfig.DEBUG && previous != nextMode) {
      Log.i("PoplurPerformance", "Mode changed $previous -> $nextMode")
    }
    notifyObservers()
  }

  private fun notifyObservers() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      handler.post { notifyObservers() }
      return
    }
    observers.toList().forEach { it.onPoplurPerformanceChanged() }
  }

  fun state(): Map<String, Any?> = mapOf(
    "mode" to mode.name,
    "thermalState" to thermalStateName(),
    "lowPowerMode" to (powerManager?.isPowerSaveMode == true),
    "memoryPressure" to memoryPressure.name.lowercase(),
    "memoryWarningCount" to memoryWarningCount,
    "appActive" to appActive,
    "targetFPS" to targetFramesPerSecond,
    "particleDensityMultiplier" to particleDensityMultiplier,
    "cacheBudgetBytes" to baseCacheBudgetBytes.toDouble(),
    "activeHeavyRendererCount" to if (activeHeavyRenderer.get() != null) 1 else 0,
    "activeHeavyRenderer" to activeHeavyRendererIdentifier,
  )

  private fun thermalStateName(): String = when (thermalStatus) {
    PowerManager.THERMAL_STATUS_LIGHT -> "light"
    PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
    PowerManager.THERMAL_STATUS_SEVERE -> "severe"
    PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
    PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
    PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
    else -> "none"
  }
}
