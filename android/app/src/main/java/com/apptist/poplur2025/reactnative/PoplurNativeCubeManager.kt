package com.apptist.poplur2025.reactnative

import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class PoplurNativeCubeManager : SimpleViewManager<PoplurNativeCubeView>() {
  override fun getName(): String = "PoplurNativeCube"

  override fun createViewInstance(reactContext: ThemedReactContext): PoplurNativeCubeView {
    return PoplurNativeCubeView(reactContext)
  }

  @ReactProp(name = "activeTab")
  fun setActiveTab(view: PoplurNativeCubeView, activeTab: String?) {
    view.setActiveTab(activeTab ?: "feed")
  }

  @ReactProp(name = "active", defaultBoolean = true)
  fun setActive(view: PoplurNativeCubeView, active: Boolean) {
    view.setPerformanceActive(active)
  }

  @ReactProp(name = "targetFps", defaultInt = 30)
  fun setTargetFps(view: PoplurNativeCubeView, targetFps: Int) {
    view.setTargetFps(targetFps)
  }

  @ReactProp(name = "performanceMode")
  fun setPerformanceMode(view: PoplurNativeCubeView, mode: String?) = Unit

  override fun onDropViewInstance(view: PoplurNativeCubeView) {
    view.dispose()
    super.onDropViewInstance(view)
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> {
    return MapBuilder.of("onTabChange", MapBuilder.of("registrationName", "onTabChange"))
  }
}
