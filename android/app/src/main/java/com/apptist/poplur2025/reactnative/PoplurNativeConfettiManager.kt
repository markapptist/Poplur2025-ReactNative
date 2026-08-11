package com.apptist.poplur2025.reactnative

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class PoplurNativeConfettiManager : SimpleViewManager<PoplurNativeConfettiView>() {
  override fun getName(): String = "PoplurNativeConfetti"

  override fun createViewInstance(reactContext: ThemedReactContext): PoplurNativeConfettiView {
    return PoplurNativeConfettiView(reactContext)
  }

  @ReactProp(name = "active", defaultBoolean = true)
  fun setActive(view: PoplurNativeConfettiView, active: Boolean) {
    view.setPerformanceActive(active)
  }

  @ReactProp(name = "targetFps", defaultInt = 30)
  fun setTargetFps(view: PoplurNativeConfettiView, targetFps: Int) {
    view.setTargetFps(targetFps)
  }

  @ReactProp(name = "particleDensity", defaultFloat = 1f)
  fun setParticleDensity(view: PoplurNativeConfettiView, density: Float) {
    view.setParticleDensity(density)
  }

  @ReactProp(name = "performanceMode")
  fun setPerformanceMode(view: PoplurNativeConfettiView, mode: String?) = Unit

  override fun onDropViewInstance(view: PoplurNativeConfettiView) {
    view.dispose()
    super.onDropViewInstance(view)
  }
}
