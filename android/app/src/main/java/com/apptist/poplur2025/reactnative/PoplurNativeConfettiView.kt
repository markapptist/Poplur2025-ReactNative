package com.apptist.poplur2025.reactnative

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import com.badlogic.gdx.math.MathUtils
import com.badlogic.gdx.math.Vector2
import com.facebook.react.uimanager.ThemedReactContext

class PoplurNativeConfettiView(context: ThemedReactContext) : View(context) {
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

  private val ticker = object : Runnable {
    override fun run() {
      if (!running) return
      invalidate()
      postOnAnimation(this)
    }
  }

  init {
    setWillNotDraw(false)
    isClickable = false
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    running = true
    lastFrameNanos = System.nanoTime()
    postOnAnimation(ticker)
  }

  override fun onDetachedFromWindow() {
    running = false
    removeCallbacks(ticker)
    super.onDetachedFromWindow()
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
    val count = 189
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
}
