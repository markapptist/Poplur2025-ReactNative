package com.apptist.poplur2025.reactnative

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import com.badlogic.gdx.math.MathUtils
import com.badlogic.gdx.math.Vector2
import com.facebook.react.uimanager.ThemedReactContext

class PoplurNativeConfettiView(context: ThemedReactContext) : View(context), PoplurPerformanceManager.Observer {
  private data class ConfettiPiece(
    val position: Vector2,
    val velocity: Vector2,
    val color: Int,
    var rotation: Float,
    val spin: Float,
    val width: Float,
    val height: Float
  )

  private val colors = intArrayOf(
    Color.rgb(240, 79, 95),
    Color.rgb(244, 121, 63),
    Color.rgb(248, 170, 56),
    Color.rgb(255, 214, 77)
  )
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
  }
  private val rect = RectF()
  private val pieces = mutableListOf<ConfettiPiece>()
  private var running = false
  private var lastFrameNanos = 0L
  private var requestedActive = true
  private var requestedTargetFps = 30
  private var requestedParticleDensity = 1f

  private val ticker = object : Runnable {
    override fun run() {
      if (!running) return
      invalidate()
      postOnAnimationDelayed(this, frameDelayMillis())
    }
  }

  init {
    setWillNotDraw(false)
    isClickable = false
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    PoplurPerformanceManager.addObserver(this)
    applyPerformancePolicy()
  }

  override fun onDetachedFromWindow() {
    running = false
    removeCallbacks(ticker)
    PoplurPerformanceManager.releaseHeavyRenderer(this)
    PoplurPerformanceManager.removeObserver(this)
    pieces.clear()
    super.onDetachedFromWindow()
  }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    applyPerformancePolicy()
  }

  override fun onVisibilityChanged(changedView: View, visibility: Int) {
    super.onVisibilityChanged(changedView, visibility)
    applyPerformancePolicy()
  }

  fun setPerformanceActive(active: Boolean) {
    requestedActive = active
    applyPerformancePolicy()
  }

  fun setTargetFps(targetFps: Int) {
    requestedTargetFps = targetFps.coerceIn(1, 60)
    applyPerformancePolicy()
  }

  fun setParticleDensity(density: Float) {
    requestedParticleDensity = density.coerceIn(0f, 1f)
    applyPerformancePolicy()
  }

  override fun onPoplurPerformanceChanged() {
    applyPerformancePolicy()
  }

  fun dispose() {
    running = false
    removeCallbacks(ticker)
    PoplurPerformanceManager.releaseHeavyRenderer(this)
    PoplurPerformanceManager.removeObserver(this)
    pieces.clear()
  }

  override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
    super.onSizeChanged(width, height, oldWidth, oldHeight)
    rebuildPieces(width, height)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (width <= 0 || height <= 0) return

    val now = System.nanoTime()
    val delta = ((now - lastFrameNanos) / 1_000_000_000f).coerceIn(0f, 0.05f)
    lastFrameNanos = now

    for (piece in pieces) {
      piece.position.mulAdd(piece.velocity, delta)
      piece.position.x += MathUtils.sin(now / 520_000_000f + piece.spin) * 18f * delta
      piece.rotation += piece.spin * delta

      if (piece.position.y > height + dp(42f)) {
        resetPiece(piece, true)
      }

      paint.color = piece.color
      canvas.save()
      canvas.rotate(piece.rotation, piece.position.x, piece.position.y)
      rect.set(
        piece.position.x - piece.width / 2f,
        piece.position.y - piece.height / 2f,
        piece.position.x + piece.width / 2f,
        piece.position.y + piece.height / 2f
      )
      canvas.drawRoundRect(rect, dp(1f), dp(1f), paint)
      canvas.restore()
    }
  }

  private fun rebuildPieces(width: Int, height: Int) {
    pieces.clear()
    val density = minOf(requestedParticleDensity, PoplurPerformanceManager.particleDensityMultiplier)
    val count = (189 * density).toInt()
    repeat(count) { index ->
      pieces.add(
        ConfettiPiece(
          position = Vector2(MathUtils.random(0f, width.toFloat()), MathUtils.random(-height * 0.65f, height.toFloat())),
          velocity = Vector2(MathUtils.random(-26f, 26f), MathUtils.random(96f, 192f)),
          color = colors[index % colors.size],
          rotation = MathUtils.random(0f, 360f),
          spin = MathUtils.random(-220f, 220f),
          width = dp(MathUtils.random(10f, 18f)),
          height = dp(MathUtils.random(4f, 8f))
        )
      )
    }
  }

  private fun resetPiece(piece: ConfettiPiece, fromTop: Boolean) {
    piece.position.x = MathUtils.random(-dp(24f), width + dp(24f))
    piece.position.y = if (fromTop) MathUtils.random(-dp(90f), -dp(12f)) else MathUtils.random(0f, height.toFloat())
    piece.velocity.x = MathUtils.random(-26f, 26f)
    piece.velocity.y = MathUtils.random(96f, 192f)
    piece.rotation = MathUtils.random(0f, 360f)
  }

  private fun dp(value: Float): Float = value * resources.displayMetrics.density

  private fun frameDelayMillis(): Long {
    val fps = minOf(requestedTargetFps, PoplurPerformanceManager.targetFramesPerSecond).coerceAtLeast(1)
    return (1000L / fps).coerceAtLeast(1)
  }

  private fun applyPerformancePolicy() {
    val shouldRun = isAttachedToWindow
      && requestedActive
      && visibility == VISIBLE
      && windowVisibility == VISIBLE
      && isShown
      && PoplurPerformanceManager.particlesAllowed
      && PoplurPerformanceManager.appActive
    val granted = shouldRun && PoplurPerformanceManager.acquireHeavyRenderer(this, "native-confetti", true)
    if (!granted) PoplurPerformanceManager.releaseHeavyRenderer(this)
    val expectedCount = if (granted) {
      (189 * minOf(requestedParticleDensity, PoplurPerformanceManager.particleDensityMultiplier)).toInt()
    } else 0
    if (expectedCount == 0) pieces.clear()
    else if (width > 0 && height > 0 && pieces.size != expectedCount) rebuildPieces(width, height)
    if (granted == running) return
    running = granted
    removeCallbacks(ticker)
    if (running) {
      lastFrameNanos = System.nanoTime()
      postOnAnimation(ticker)
    }
  }
}
