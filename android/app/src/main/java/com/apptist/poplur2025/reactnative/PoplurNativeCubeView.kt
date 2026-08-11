package com.apptist.poplur2025.reactnative

import android.animation.ValueAnimator
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.View
import android.view.animation.DecelerateInterpolator
import com.badlogic.gdx.math.Matrix4
import com.badlogic.gdx.math.Vector3
import com.facebook.react.bridge.Arguments
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter
import kotlin.math.abs
import kotlin.math.max

class PoplurNativeCubeView(private val reactContext: ThemedReactContext) : View(reactContext), PoplurPerformanceManager.Observer {
  private data class Face(val tab: String, val indices: IntArray)
  private data class ProjectedFace(val face: Face, val points: List<Pair<Float, Float>>, val depth: Float)

  private val tabs = listOf("feed", "map", "record", "profile", "settings")
  private val labels = mapOf("feed" to "Feed", "map" to "Map", "record" to "Record", "profile" to "Profile", "settings" to "Settings")
  private val glyphs = mapOf("feed" to "F", "map" to "M", "record" to "+", "profile" to "P", "settings" to "S")
  private val colors = mapOf(
    "feed" to Color.rgb(20, 184, 166),
    "map" to Color.rgb(79, 70, 229),
    "record" to Color.rgb(249, 115, 22),
    "profile" to Color.rgb(8, 145, 178),
    "settings" to Color.rgb(51, 65, 85)
  )

  private val vertices = arrayOf(
    Vector3(-1f, -1f, 1f), Vector3(1f, -1f, 1f), Vector3(1f, 1f, 1f), Vector3(-1f, 1f, 1f),
    Vector3(-1f, -1f, -1f), Vector3(1f, -1f, -1f), Vector3(1f, 1f, -1f), Vector3(-1f, 1f, -1f)
  )
  private val faces = listOf(
    Face("feed", intArrayOf(0, 1, 2, 3)),
    Face("map", intArrayOf(1, 5, 6, 2)),
    Face("record", intArrayOf(4, 0, 3, 7)),
    Face("profile", intArrayOf(3, 2, 6, 7)),
    Face("settings", intArrayOf(4, 5, 1, 0)),
    Face("feed", intArrayOf(5, 4, 7, 6))
  )

  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = dp(1.2f)
    color = Color.argb(96, 255, 255, 255)
  }
  private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    textAlign = Paint.Align.CENTER
    typeface = android.graphics.Typeface.DEFAULT_BOLD
  }
  private val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(78, 0, 0, 0) }
  private val railPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(194, 5, 7, 19) }
  private val railStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(46, 255, 255, 255)
    style = Paint.Style.STROKE
    strokeWidth = dp(1f)
  }

  private var activeTab = "feed"
  private var rotationX = 0f
  private var rotationY = 0f
  private var animator: ValueAnimator? = null
  private var requestedActive = true
  private var requestedTargetFps = 30
  private var lastAnimationDrawNanos = 0L
  private val gestureDetector = GestureDetector(context, CubeGestureListener())

  init {
    setWillNotDraw(false)
    isClickable = true
  }

  fun setActiveTab(tab: String) {
    val next = if (tabs.contains(tab)) tab else "feed"
    if (next == activeTab) return
    activeTab = next
    animateTo(next)
    invalidate()
  }

  fun setPerformanceActive(active: Boolean) {
    requestedActive = active
    applyPerformancePolicy()
  }

  fun setTargetFps(targetFps: Int) {
    requestedTargetFps = targetFps.coerceIn(1, 60)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    PoplurPerformanceManager.addObserver(this)
    applyPerformancePolicy()
  }

  override fun onDetachedFromWindow() {
    dispose()
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

  override fun onPoplurPerformanceChanged() {
    applyPerformancePolicy()
  }

  fun dispose() {
    animator?.cancel()
    animator = null
    PoplurPerformanceManager.removeObserver(this)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (width == 0 || height == 0) return

    val railHeight = dp(42f)
    val cubeAreaHeight = height - railHeight + dp(8f)
    val centerX = width / 2f
    val centerY = cubeAreaHeight / 2f - dp(4f)
    val cubeSize = max(1f, minOf(width * 0.42f, cubeAreaHeight * 0.6f))

    canvas.drawOval(
      centerX - cubeSize * 0.58f,
      centerY + cubeSize * 0.74f,
      centerX + cubeSize * 0.58f,
      centerY + cubeSize * 0.9f,
      shadowPaint
    )

    val matrix = Matrix4().idt().rotate(Vector3.X, rotationX).rotate(Vector3.Y, rotationY)
    val projected = faces.map { face ->
      val points = face.indices.map { index ->
        val vector = Vector3(vertices[index]).mul(matrix)
        val perspective = 2.8f / (2.8f - vector.z)
        centerX + vector.x * cubeSize * perspective * 0.5f to centerY - vector.y * cubeSize * perspective * 0.5f
      }
      val depth = face.indices.map { Vector3(vertices[it]).mul(matrix).z }.average().toFloat()
      ProjectedFace(face, points, depth)
    }.sortedBy { it.depth }

    for (projectedFace in projected) {
      drawFace(canvas, projectedFace)
    }

    drawRail(canvas, railHeight)
  }

  private fun drawFace(canvas: Canvas, projectedFace: ProjectedFace) {
    val path = Path()
    projectedFace.points.forEachIndexed { index, point ->
      if (index == 0) path.moveTo(point.first, point.second) else path.lineTo(point.first, point.second)
    }
    path.close()

    val base = colors[projectedFace.face.tab] ?: colors.getValue("feed")
    val shade = ((projectedFace.depth + 1.4f) / 2.8f).coerceIn(0.42f, 1f)
    fillPaint.color = shadeColor(base, shade)
    canvas.drawPath(path, fillPaint)
    canvas.drawPath(path, strokePaint)

    if (projectedFace.face.tab == activeTab && projectedFace.depth > -0.25f) {
      val cx = projectedFace.points.map { it.first }.average().toFloat()
      val cy = projectedFace.points.map { it.second }.average().toFloat()
      textPaint.textSize = dp(16f)
      canvas.drawText(labels[activeTab] ?: "Feed", cx, cy + dp(6f), textPaint)
    }
  }

  private fun drawRail(canvas: Canvas, railHeight: Float) {
    val rail = RectF(dp(15f), height - railHeight, width - dp(15f), height.toFloat())
    canvas.drawRoundRect(rail, dp(8f), dp(8f), railPaint)
    canvas.drawRoundRect(rail, dp(8f), dp(8f), railStrokePaint)

    val buttonSize = dp(34f)
    val gap = dp(8f)
    val total = buttonSize * tabs.size + gap * (tabs.size - 1)
    var x = width / 2f - total / 2f
    val y = height - railHeight / 2f - buttonSize / 2f
    tabs.forEach { tab ->
      val rect = RectF(x, y, x + buttonSize, y + buttonSize)
      fillPaint.color = if (tab == activeTab) colors[tab] ?: Color.WHITE else Color.argb(26, 255, 255, 255)
      canvas.drawRoundRect(rect, dp(8f), dp(8f), fillPaint)
      textPaint.textSize = dp(16f)
      canvas.drawText(glyphs[tab] ?: "F", rect.centerX(), rect.centerY() + dp(5.5f), textPaint)
      x += buttonSize + gap
    }
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    gestureDetector.onTouchEvent(event)
    return true
  }

  private fun animateTo(tab: String) {
    val (targetX, targetY) = rotationForTab(tab)
    val startX = rotationX
    val startY = rotationY
    animator?.cancel()
    animator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 340
      interpolator = DecelerateInterpolator()
      addUpdateListener {
        val progress = it.animatedValue as Float
        val now = System.nanoTime()
        val targetFps = minOf(requestedTargetFps, PoplurPerformanceManager.targetFramesPerSecond).coerceAtLeast(1)
        val frameNanos = 1_000_000_000L / targetFps
        if (progress < 1f && now - lastAnimationDrawNanos < frameNanos) return@addUpdateListener
        lastAnimationDrawNanos = now
        rotationX = startX + (targetX - startX) * progress
        rotationY = startY + (targetY - startY) * progress
        invalidate()
      }
      start()
    }
  }

  private fun rotationForTab(tab: String): Pair<Float, Float> {
    return when (tab) {
      "map" -> 0f to -90f
      "record" -> 0f to 90f
      "profile" -> 90f to 0f
      "settings" -> -90f to 0f
      else -> 0f to 0f
    }
  }

  private fun sendTab(tab: String) {
    if (!tabs.contains(tab)) return
    val event = Arguments.createMap().apply { putString("tab", tab) }
    reactContext.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, "onTabChange", event)
  }

  private fun sendOffset(offset: Int) {
    val current = tabs.indexOf(activeTab).takeIf { it >= 0 } ?: 0
    val next = (current + offset + tabs.size) % tabs.size
    sendTab(tabs[next])
  }

  private fun tabFromRail(x: Float, y: Float): String? {
    val railHeight = dp(42f)
    if (y < height - railHeight) return null
    val buttonSize = dp(34f)
    val gap = dp(8f)
    val total = buttonSize * tabs.size + gap * (tabs.size - 1)
    var left = width / 2f - total / 2f
    tabs.forEach { tab ->
      if (x >= left && x <= left + buttonSize) return tab
      left += buttonSize + gap
    }
    return null
  }

  private inner class CubeGestureListener : GestureDetector.SimpleOnGestureListener() {
    override fun onSingleTapUp(event: MotionEvent): Boolean {
      val tab = tabFromRail(event.x, event.y)
      if (tab != null) {
        sendTab(tab)
      } else {
        sendOffset(1)
      }
      return true
    }

    override fun onFling(e1: MotionEvent?, e2: MotionEvent, velocityX: Float, velocityY: Float): Boolean {
      val dominant = if (abs(velocityX) >= abs(velocityY)) velocityX else -velocityY
      if (abs(dominant) < 140f) return false
      sendOffset(if (dominant < 0) 1 else -1)
      return true
    }
  }

  private fun dp(value: Float): Float = value * resources.displayMetrics.density

  private fun shadeColor(color: Int, shade: Float): Int {
    return Color.rgb(
      (Color.red(color) * shade).toInt().coerceIn(0, 255),
      (Color.green(color) * shade).toInt().coerceIn(0, 255),
      (Color.blue(color) * shade).toInt().coerceIn(0, 255)
    )
  }

  private fun applyPerformancePolicy() {
    val active = requestedActive
      && isAttachedToWindow
      && visibility == VISIBLE
      && windowVisibility == VISIBLE
      && PoplurPerformanceManager.appActive
    if (!active) animator?.cancel()
  }
}
