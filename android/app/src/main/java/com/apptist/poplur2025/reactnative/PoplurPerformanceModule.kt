package com.apptist.poplur2025.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class PoplurPerformanceModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), PoplurPerformanceManager.Observer {
  private var listenerCount = 0

  override fun getName(): String = "PoplurPerformanceNative"

  override fun initialize() {
    super.initialize()
    PoplurPerformanceManager.initialize(reactContext.applicationContext as android.app.Application)
    PoplurPerformanceManager.addObserver(this)
  }

  override fun invalidate() {
    PoplurPerformanceManager.removeObserver(this)
    super.invalidate()
  }

  @ReactMethod
  fun getCurrentState(promise: Promise) {
    promise.resolve(Arguments.makeNativeMap(PoplurPerformanceManager.state()))
  }

  @ReactMethod
  fun addListener(eventName: String) {
    listenerCount += 1
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    listenerCount = (listenerCount - count).coerceAtLeast(0)
  }

  override fun onPoplurPerformanceChanged() {
    if (listenerCount <= 0 || !reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("PoplurPerformanceDidChange", Arguments.makeNativeMap(PoplurPerformanceManager.state()))
  }
}
