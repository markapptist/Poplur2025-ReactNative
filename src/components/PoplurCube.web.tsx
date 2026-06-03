import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as THREE from 'three';
import type { AppTab } from '../types/models';

const tabs: AppTab[] = ['feed', 'map', 'record', 'profile', 'settings'];
const icons: Record<AppTab, keyof typeof Ionicons.glyphMap> = {
  record: 'add-circle',
  feed: 'list',
  profile: 'person-circle',
  map: 'map',
  settings: 'settings'
};

const faceTabs: AppTab[] = ['map', 'record', 'profile', 'settings', 'feed', 'feed'];
const rotations: Record<AppTab, { x: number; y: number }> = {
  feed: { x: 0, y: 0 },
  map: { x: 0, y: -Math.PI / 2 },
  record: { x: 0, y: Math.PI / 2 },
  profile: { x: Math.PI / 2, y: 0 },
  settings: { x: -Math.PI / 2, y: 0 }
};

function createFaceTexture(label: string, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.CanvasTexture(canvas);

  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(255,255,255,0.42)';
  context.lineWidth = 10;
  context.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
  context.fillStyle = 'rgba(255,255,255,0.16)';
  context.beginPath();
  context.arc(256, 210, 86, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffffff';
  context.font = '900 58px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 256, 324);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function PoplurCube({ activeTab, onTabChange }: { activeTab: AppTab; onTabChange: (tab: AppTab) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(activeTab);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const textures = useMemo(() => [
    createFaceTexture('Map', '#4f46e5'),
    createFaceTexture('Record', '#f97316'),
    createFaceTexture('Profile', '#0891b2'),
    createFaceTexture('Settings', '#334155'),
    createFaceTexture('Feed', '#14b8a6'),
    createFaceTexture('Poplur', '#e11d48')
  ], []);

  useEffect(() => {
    activeRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const sceneCanvas = canvas;
    const sceneHost = host;

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0.12, 5.2);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const materials = textures.map(texture => new THREE.MeshStandardMaterial({ map: texture, roughness: 0.46, metalness: 0.12 }));
    const cube = new THREE.Mesh(new THREE.BoxGeometry(2.25, 2.25, 2.25), materials);
    scene.add(cube);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(cube.geometry),
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.38 })
    );
    cube.add(edges);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1.85, 48),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.55;
    scene.add(floor);

    scene.add(new THREE.AmbientLight('#dbeafe', 1.4));
    const keyLight = new THREE.DirectionalLight('#ffffff', 2.3);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight('#38bdf8', 1.1);
    rimLight.position.set(-4, 2, -2);
    scene.add(rimLight);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let width = 0;
    let height = 0;
    let animationFrame = 0;

    function resize() {
      const nextWidth = Math.max(sceneHost.clientWidth, 1);
      const nextHeight = Math.max(sceneHost.clientHeight, 1);
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }

    function animate() {
      resize();
      const target = rotations[activeRef.current] ?? rotations.feed;
      cube.rotation.x += (target.x - cube.rotation.x) * 0.12;
      cube.rotation.y += (target.y - cube.rotation.y) * 0.12;
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    }

    function chooseFace(clientX: number, clientY: number) {
      const rect = sceneCanvas.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      pointer.y = -(((clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(cube)[0];
      const tab = faceTabs[hit?.face?.materialIndex ?? -1];
      if (tab) onTabChange(tab);
    }

    function pointerDown(event: PointerEvent) {
      dragStartRef.current = { x: event.clientX, y: event.clientY };
    }

    function pointerUp(event: PointerEvent) {
      const start = dragStartRef.current;
      dragStartRef.current = null;
      if (!start) return chooseFace(event.clientX, event.clientY);

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 14) return chooseFace(event.clientX, event.clientY);
      if (Math.abs(dx) > Math.abs(dy)) {
        onTabChange(dx < 0 ? 'map' : 'record');
      } else {
        onTabChange(dy < 0 ? 'profile' : 'settings');
      }
    }

    animate();
    const observer = new ResizeObserver(resize);
    observer.observe(sceneHost);
    sceneCanvas.addEventListener('pointerdown', pointerDown);
    sceneCanvas.addEventListener('pointerup', pointerUp);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      sceneCanvas.removeEventListener('pointerdown', pointerDown);
      sceneCanvas.removeEventListener('pointerup', pointerUp);
      renderer.dispose();
      cube.geometry.dispose();
      edges.geometry.dispose();
      floor.geometry.dispose();
      materials.forEach(material => material.dispose());
    };
  }, [onTabChange, textures]);

  useEffect(() => () => {
    textures.forEach(texture => texture.dispose());
  }, [textures]);

  return (
    <View style={styles.wrapper}>
      <View style={styles.canvasHost}>
        {React.createElement('canvas', {
          ref: canvasRef,
          'aria-label': 'Poplur tab cube',
          style: styles.canvas
        })}
      </View>
      <View style={styles.tabRail}>
        {tabs.map(tab => (
          <Pressable key={tab} onPress={() => onTabChange(tab)} style={[styles.tabButton, activeTab === tab && styles.activeButton]}>
            <Ionicons name={icons[tab]} size={22} color="white" />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { height: 230, width: 260, alignItems: 'center', justifyContent: 'center', pointerEvents: 'box-none' },
  canvasHost: { width: 182, height: 162 },
  canvas: { width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: 'grab' } as any,
  tabRail: { height: 42, minWidth: 230, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(5,7,19,0.74)', borderColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderRadius: 8, paddingHorizontal: 8 },
  tabButton: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  activeButton: { backgroundColor: '#4f46e5' }
});
