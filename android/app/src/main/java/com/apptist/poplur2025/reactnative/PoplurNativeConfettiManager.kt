package com.apptist.poplur2025.reactnative

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

class PoplurNativeConfettiManager : SimpleViewManager<PoplurNativeConfettiView>() {
  override fun getName(): String = "PoplurNativeConfetti"

  override fun createViewInstance(reactContext: ThemedReactContext): PoplurNativeConfettiView {
    return PoplurNativeConfettiView(reactContext)
  }
}
