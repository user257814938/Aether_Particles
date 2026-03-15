"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import handsPackage from "@mediapipe/hands";
import styles from "./AetherParticles.module.css";

const { Hands } = handsPackage;

// Central preset registry:
// - `color` defines the auto-selected default tint for each model
// - `icon` supports faster visual recognition in the sidebar
// - `rotation` decides whether the shape can tilt vertically or should stay front-facing
const PRESETS = {
  sphere: { label: "Sphere", color: "#2563eb", icon: "\u25CF", rotation: "full" },
  heart: { label: "Heart", color: "#dc2626", icon: "\u2665", rotation: "drift" },
  saturn: { label: "Saturn", color: "#caa46b", icon: "\u{1FA90}", rotation: "side" },
  buddha: { label: "Buddha", color: "#b7791f", icon: "\u2638", rotation: "drift" },
  flower: { label: "Flower", color: "#e11d48", icon: "\u273F", rotation: "lotusSweep" },
  lotus: { label: "Lotus", color: "#ec4899", icon: "\u{1FAB7}", rotation: "lotusSweep" },
  fireworks: { label: "Fireworks", color: "#b91c1c", icon: "\u2726", rotation: "full" },
  supernova: { label: "Supernova", color: "#8b5cf6", icon: "\u273A", rotation: "galaxyTilt" },
  cube: { label: "Cube", color: "#14b8a6", icon: "\u25A3", rotation: "full" },
  square: { label: "Square", color: "#d97706", icon: "\u25A0", rotation: "drift" },
};

const PRESET_SECTIONS = [
  ["heart", "buddha"],
  ["flower", "lotus"],
  ["cube", "square"],
  ["sphere", "saturn"],
  ["supernova", "fireworks"],
];

const DEFAULT_STATUS = {
  id: "boot",
  tone: "neutral",
  text: "Allow camera access to control the sculpture with your hand.",
};

export default function AetherParticles() {
  const panelRef = useRef(null);
  const canvasRef = useRef(null);
  const hiddenVideoRef = useRef(null);
  const previewVideoRef = useRef(null);
  const animationFrameRef = useRef(0);
  const targetPositionsRef = useRef(new Float32Array());
  const targetColorsRef = useRef(new Float32Array());
  const handsRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const handRequestInFlightRef = useRef(false);
  const currentExpansionRef = useRef(0.5);
  const targetExpansionRef = useRef(0.5);
  const colorTargetRef = useRef(new THREE.Color(PRESETS.sphere.color));
  const particleCountRef = useRef(0);
  const mountedRef = useRef(false);
  const activePresetRef = useRef("sphere");
  const [preset, setPreset] = useState("sphere");
  const [particleColor, setParticleColor] = useState(PRESETS.sphere.color);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [forceLevel, setForceLevel] = useState(0);
  const [cameraDockMetrics, setCameraDockMetrics] = useState({
    left: 24,
    top: 24,
    width: 356,
  });
  // The onboarding guide opens by default, then becomes user-controlled via the left panel.
  const [isGuideOpen, setIsGuideOpen] = useState(true);

  const presetSections = PRESET_SECTIONS.map((section) =>
    section.map((key) => [key, PRESETS[key]]),
  );

  useEffect(() => {
    activePresetRef.current = preset;
    if (particleCountRef.current > 0) {
      const presetData = buildPresetData(
        preset,
        particleCountRef.current,
        PRESETS[preset].color,
      );
      targetPositionsRef.current = presetData.positions;
      targetColorsRef.current = presetData.colors;
    }
  }, [preset]);

  useEffect(() => {
    colorTargetRef.current.set(particleColor);
    if (particleCountRef.current > 0 && activePresetRef.current !== "supernova") {
      targetColorsRef.current = buildPresetColors(
        activePresetRef.current,
        particleCountRef.current,
        particleColor,
      );
    }
  }, [particleColor]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsGuideOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!panelRef.current) {
      return undefined;
    }

    const updateMetrics = () => {
      const panel = panelRef.current;

      if (!panel) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      setCameraDockMetrics({
        left: rect.left,
        top: rect.bottom + 16,
        width: rect.width,
      });
    };

    updateMetrics();

    const resizeObserver = new ResizeObserver(() => {
      updateMetrics();
    });

    resizeObserver.observe(panelRef.current);
    window.addEventListener("resize", updateMetrics);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateMetrics);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hiddenVideo = hiddenVideoRef.current;
    const previewVideo = previewVideoRef.current;

    if (!canvas || !hiddenVideo || !previewVideo) {
      return undefined;
    }

    mountedRef.current = true;
    const particleCount = window.innerWidth < 768 ? 7000 : 15000;
    particleCountRef.current = particleCount;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.z = 15;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = createSolidColors(particleCount, PRESETS.sphere.color);

    for (let index = 0; index < positions.length; index += 1) {
      positions[index] = (Math.random() - 0.5) * 20;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.05,
      color: "#ffffff",
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    const initialPresetData = buildPresetData(
      activePresetRef.current,
      particleCount,
      PRESETS[activePresetRef.current].color,
    );
    targetPositionsRef.current = initialPresetData.positions;
    targetColorsRef.current = initialPresetData.colors;

    const updateStatus = (nextStatus) => {
      if (!mountedRef.current) {
        return;
      }

      setStatus((previousStatus) =>
        previousStatus.id === nextStatus.id ? previousStatus : nextStatus,
      );
    };

    const updateForceLevel = (nextForceLevel) => {
      if (!mountedRef.current) {
        return;
      }

      const clampedForce = THREE.MathUtils.clamp(nextForceLevel, 0, 1);
      setForceLevel((previousForceLevel) =>
        Math.abs(previousForceLevel - clampedForce) < 0.015
          ? previousForceLevel
          : clampedForce,
      );
    };

    const syncPreviewStream = () => {
      if (!previewVideoRef.current || !hiddenVideoRef.current?.srcObject) {
        return;
      }

      previewVideoRef.current.srcObject = hiddenVideoRef.current.srcObject;
      previewVideoRef.current.play().catch(() => {});
    };

    const resize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const handleResults = (results) => {
      const handLandmarks = results.multiHandLandmarks ?? [];

      if (handLandmarks.length > 0) {
        let totalTension = 0;

        handLandmarks.forEach((landmarks) => {
          const thumb = landmarks[4];
          const pinky = landmarks[20];
          totalTension += Math.hypot(thumb.x - pinky.x, thumb.y - pinky.y);
        });

        const averageTension = totalTension / handLandmarks.length;
        // Gesture openness powers both the particle expansion and the force gauge in the dock.
        const opennessForce = THREE.MathUtils.clamp(
          THREE.MathUtils.mapLinear(averageTension, 0.1, 0.5, 0, 1),
          0,
          1,
        );

        targetExpansionRef.current = THREE.MathUtils.clamp(
          THREE.MathUtils.mapLinear(averageTension, 0.1, 0.5, 0.2, 2.5),
          0.2,
          2.5,
        );
        updateForceLevel(opennessForce);

        updateStatus({
          id: "tracking",
          tone: "ready",
          text: "Tracking active: open your hand to expand, close it to gather.",
        });
        return;
      }

      targetExpansionRef.current = 0.8;
      updateForceLevel(0);
      updateStatus({
        id: "idle",
        tone: "neutral",
        text: "Camera active. Place your hand in frame to resume control.",
      });
    };

    const renderFrame = () => {
      animationFrameRef.current = window.requestAnimationFrame(renderFrame);

      if (
        handsRef.current &&
        !handRequestInFlightRef.current &&
        hiddenVideo.readyState >= 2 &&
        hiddenVideo.currentTime !== lastVideoTimeRef.current
      ) {
        handRequestInFlightRef.current = true;
        lastVideoTimeRef.current = hiddenVideo.currentTime;
        handsRef.current
          .send({ image: hiddenVideo })
          .catch(() => {
            updateStatus({
              id: "tracking-error",
              tone: "error",
              text: "Hand tracking failed in this session. Reload the page to try again.",
            });
          })
          .finally(() => {
            handRequestInFlightRef.current = false;
          });
      }

      const positionAttribute = geometry.attributes.position;
      const colorAttribute = geometry.attributes.color;
      const targetPositions = targetPositionsRef.current;
      const targetColors = targetColorsRef.current;
      currentExpansionRef.current +=
        (targetExpansionRef.current - currentExpansionRef.current) * 0.1;

      for (let index = 0; index < particleCount; index += 1) {
        const offset = index * 3;
        const targetX = targetPositions[offset] * currentExpansionRef.current;
        const targetY = targetPositions[offset + 1] * currentExpansionRef.current;
        const targetZ = targetPositions[offset + 2] * currentExpansionRef.current;

        positionAttribute.array[offset] += (targetX - positionAttribute.array[offset]) * 0.05;
        positionAttribute.array[offset + 1] +=
          (targetY - positionAttribute.array[offset + 1]) * 0.05;
        positionAttribute.array[offset + 2] +=
          (targetZ - positionAttribute.array[offset + 2]) * 0.05;

        colorAttribute.array[offset] += (targetColors[offset] - colorAttribute.array[offset]) * 0.08;
        colorAttribute.array[offset + 1] +=
          (targetColors[offset + 1] - colorAttribute.array[offset + 1]) * 0.08;
        colorAttribute.array[offset + 2] +=
          (targetColors[offset + 2] - colorAttribute.array[offset + 2]) * 0.08;
      }

      positionAttribute.needsUpdate = true;
      colorAttribute.needsUpdate = true;
      // Silhouettes stay readable from the front, horizontal models orbit sideways, volumetric objects spin freely.
      const rotationMode = PRESETS[activePresetRef.current].rotation;
      const time = performance.now() * 0.001;

      if (rotationMode === "full") {
        particles.rotation.y += 0.002;
        particles.rotation.x += 0.001;
        particles.rotation.z += (0 - particles.rotation.z) * 0.08;
      } else if (rotationMode === "lotusSweep") {
        const targetX = -0.2 + Math.cos(time * 0.42) * 0.025;
        const targetY = (Math.sin(time * 0.42) * 0.5 + 0.5) * 1.12;
        particles.rotation.x += (targetX - particles.rotation.x) * 0.08;
        particles.rotation.y += (targetY - particles.rotation.y) * 0.08;
        particles.rotation.z += (0 - particles.rotation.z) * 0.08;
      } else if (rotationMode === "drift") {
        const targetX = Math.sin(time * 0.95) * 0.13;
        const targetY = Math.cos(time * 0.72) * 0.22;
        particles.rotation.x += (targetX - particles.rotation.x) * 0.08;
        particles.rotation.y += (targetY - particles.rotation.y) * 0.08;
        particles.rotation.z += (0 - particles.rotation.z) * 0.08;
      } else if (rotationMode === "bloom") {
        const targetX = Math.sin(time * 0.8) * 0.15;
        const targetY = Math.cos(time * 0.64) * 0.18;
        particles.rotation.x += (targetX - particles.rotation.x) * 0.08;
        particles.rotation.y += (targetY - particles.rotation.y) * 0.08;
        particles.rotation.z += 0.0025;
      } else if (rotationMode === "bloomFront") {
        const targetX = Math.sin(time * 0.74) * 0.08;
        const targetY = Math.cos(time * 0.58) * 0.1;
        particles.rotation.x += (targetX - particles.rotation.x) * 0.08;
        particles.rotation.y += (targetY - particles.rotation.y) * 0.08;
        particles.rotation.z += 0.0022;
      } else if (rotationMode === "galaxyTilt") {
        const targetX = 1.72 + Math.sin(time * 0.56) * 0.62;
        const targetY = Math.cos(time * 0.44) * 0.18;
        particles.rotation.x += (targetX - particles.rotation.x) * 0.08;
        particles.rotation.y += (targetY - particles.rotation.y) * 0.08;
        particles.rotation.z += (0 - particles.rotation.z) * 0.08;
      } else if (rotationMode === "side") {
        const targetX = 0.36 + Math.sin(time * 0.9) * 0.13;
        const targetY = 0.82 + Math.cos(time * 0.52) * 0.08;
        particles.rotation.x += (targetX - particles.rotation.x) * 0.08;
        particles.rotation.y += (targetY - particles.rotation.y) * 0.08;
        particles.rotation.z += (0 - particles.rotation.z) * 0.08;
      } else {
        particles.rotation.y += (0 - particles.rotation.y) * 0.08;
        particles.rotation.x += (0 - particles.rotation.x) * 0.08;
        particles.rotation.z += (0 - particles.rotation.z) * 0.08;
      }

      renderer.render(scene, camera);
    };

    const requestCameraStream = async () => {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });
      } catch (error) {
        if (error?.name === "OverconstrainedError") {
          return navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        throw error;
      }
    };

    const boot = async () => {
      resize();
      renderFrame();

      try {
        const hands = new Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        hands.onResults(handleResults);
        handsRef.current = hands;

        const stream = await requestCameraStream();

        mediaStreamRef.current = stream;
        hiddenVideo.srcObject = stream;
        previewVideo.srcObject = stream;

        await hiddenVideo.play();
        syncPreviewStream();

        updateStatus({
          id: "camera-ready",
          tone: "ready",
          text: "Camera connected. Open your hand to spread the particles.",
        });
        updateForceLevel(0);
      } catch (error) {
        updateForceLevel(0);

        const cameraMessageByError = {
          NotAllowedError:
            "Camera access denied. Allow the camera in your browser to enable gesture control.",
          NotReadableError:
            "The camera is already in use by another application or unavailable. Close the other app and reload the page.",
          NotFoundError:
            "No camera detected on this device. The preset remains visible, but gesture control is unavailable.",
          AbortError:
            "Camera startup was interrupted. Reload the page to try again.",
        };

        if (!cameraMessageByError[error?.name]) {
          console.error(error);
        }

        updateStatus({
          id: "camera-error",
          tone: "error",
          text:
            cameraMessageByError[error?.name] ??
            "Camera access was denied or is unavailable. The preset remains visible, but gesture control is unavailable.",
        });
      }
    };

    window.addEventListener("resize", resize);
    boot();

    return () => {
      mountedRef.current = false;
      window.cancelAnimationFrame(animationFrameRef.current);
      window.removeEventListener("resize", resize);

      if (handsRef.current) {
        handsRef.current.close().catch(() => {});
        handsRef.current = null;
      }

      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;

      if (hiddenVideoRef.current) {
        hiddenVideoRef.current.srcObject = null;
      }

      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = null;
      }

      particles.removeFromParent();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  const handlePresetChange = (nextPreset) => {
    setPreset(nextPreset);
    setParticleColor(PRESETS[nextPreset].color);
  };

  const forcePercent = Math.round(forceLevel * 100);
  const showStatusNote = status.tone === "error";
  const cameraDockStyle = useMemo(
    () => ({
      left: `${cameraDockMetrics.left}px`,
      top: `${cameraDockMetrics.top}px`,
      width: `${cameraDockMetrics.width}px`,
    }),
    [cameraDockMetrics],
  );

  return (
    <main className={styles.page}>
      <canvas ref={canvasRef} className={styles.canvas} />

      <section ref={panelRef} className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.brand}>
            <AetherLogo className={styles.logo} />
            <div>
              <h1 className={styles.title}>aether</h1>
              <p className={styles.description}>Gesture-reactive particle sculpture.</p>
            </div>
          </div>
        </div>

        {showStatusNote ? (
          <p className={styles.status} data-tone={status.tone}>
            {status.text}
          </p>
        ) : null}

        <div className={styles.panelBody}>
          <div className={styles.block}>
            <span className={styles.label}>Shape Template</span>
            <div className={styles.presetGrid}>
              {presetSections.map((section, sectionIndex) => (
                <div key={`section-${sectionIndex}`} className={styles.presetGroup}>
                  <div className={styles.presetSection}>
                    {section.map(([key, value]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handlePresetChange(key)}
                        className={styles.presetButton}
                        data-active={preset === key}
                      >
                        <span className={styles.presetIcon} aria-hidden="true">
                          {value.icon}
                        </span>
                        <span className={styles.presetLabel}>{value.label}</span>
                      </button>
                    ))}
                  </div>
                  <div className={styles.presetDivider} aria-hidden="true" />
                </div>
              ))}
            </div>
          </div>

          <div className={styles.block}>
            <label htmlFor="particle-color" className={styles.label}>
              Color
            </label>
            <div className={styles.colorCard}>
              <label htmlFor="particle-color" className={styles.colorControl}>
                <span
                  className={styles.colorPreview}
                  style={{ "--preview-color": particleColor }}
                />
                <span className={styles.colorMeta}>
                  <span className={styles.colorName}>Custom Color</span>
                  <span className={styles.colorValue}>{particleColor.toUpperCase()}</span>
                </span>
                <span className={styles.colorArrow} aria-hidden="true">
                  |
                </span>
                <input
                  id="particle-color"
                  type="color"
                  value={particleColor}
                  onChange={(event) => setParticleColor(event.target.value)}
                  className={styles.colorInput}
                />
              </label>
            </div>
          </div>

          <div className={styles.block}>
            <span className={styles.label}>Force</span>
            <div className={styles.sidebarMeter}>
              <div className={styles.forceMeter}>
                <span className={styles.forceIcon} aria-hidden="true">
                  {"\u270A"}
                </span>

                <div className={styles.forceTrack} aria-label="Hand openness force meter">
                  <div className={styles.forceFill} style={{ width: `${forcePercent}%` }} />
                  <div className={styles.forceThumb} style={{ left: `${forcePercent}%` }} />
                </div>

                <span className={styles.forceIcon} aria-hidden="true">
                  {"\u270B"}
                </span>
              </div>
            </div>
          </div>

        </div>

        <div className={styles.guideBlock}>
          <span className={styles.label}>Guide</span>
          <button
          type="button"
          className={styles.helpButton}
          onClick={() => setIsGuideOpen(true)}
        >
          <span className={styles.helpButtonIcon} aria-hidden="true">
            ↗
          </span>
          <span className={styles.helpButtonText}>How to use the system</span>
          </button>
        </div>
      </section>

      <div className={styles.cameraDock} style={cameraDockStyle}>
        <div className={styles.cameraWrap}>
          <video ref={previewVideoRef} className={styles.previewVideo} autoPlay playsInline muted />
        </div>
      </div>

      <video ref={hiddenVideoRef} className={styles.hiddenVideo} playsInline muted />

      {/* Welcome guide shown on first load and reopened later through the help button. */}
      <div
        className={`${styles.guideOverlay} ${
          isGuideOpen ? styles.guideOverlayVisible : styles.guideOverlayHidden
        }`}
        aria-hidden={!isGuideOpen}
      >
        <section className={styles.guideCard} role="dialog" aria-modal="true" aria-label="Welcome guide">
          <p className={styles.guideEyebrow}>Welcome guide</p>
          <h2 className={styles.guideTitle}>How to use the system</h2>
          <p className={styles.guideText}>
            The camera transforms your hand openness into force. Closed fist: the meter
            drops. Open hand: the meter rises and the sculpture unfolds.
          </p>

          <div className={styles.guideSteps}>
            <div className={styles.guideStep}>
              <span className={styles.guideStepNumber}>1</span>
              <div>
                <strong className={styles.guideStepTitle}>Allow the camera</strong>
                <p className={styles.guideStepText}>
                  Reste visible dans l'aperçu en bas a gauche pour que le suivi reste stable.
                </p>
              </div>
            </div>

            <div className={styles.guideStep}>
              <span className={styles.guideStepNumber}>2</span>
              <div>
                <strong className={styles.guideStepTitle}>Watch the meter</strong>
                <p className={styles.guideStepText}>
                  It moves from 0% to 100% based on your hand opening, from closed fist to open hand.
                </p>
              </div>
            </div>

            <div className={styles.guideStep}>
              <span className={styles.guideStepNumber}>3</span>
              <div>
                <strong className={styles.guideStepTitle}>Try the presets</strong>
                <p className={styles.guideStepText}>
                  Use the presets and color tools in the left panel to change the result.
                </p>
              </div>
            </div>
          </div>

          <div className={styles.guideLegend}>
            <div className={styles.guideLegendItem}>
              <span className={styles.guideLegendIcon}>{"\u270A"}</span>
              <span>Closed fist: low force, contracted particles.</span>
            </div>
            <div className={styles.guideLegendItem}>
              <span className={styles.guideLegendIcon}>{"\u270B"}</span>
              <span>Open hand: high force, expanded particles.</span>
            </div>
          </div>

          <div className={styles.guideActions}>
            <button type="button" className={styles.guideCloseButton} onClick={() => setIsGuideOpen(false)}>
              Start
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function AetherLogo({ className }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="aether-logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f5d0fe" />
          <stop offset="52%" stopColor="#7dd3fc" />
          <stop offset="100%" stopColor="#60a5fa" />
        </linearGradient>
      </defs>
      <path
        d="M18 38c7-14 21-21 30-14 6 4 6 11 2 17"
        fill="none"
        stroke="url(#aether-logo-gradient)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M18 26c9 12 24 17 32 10"
        fill="none"
        stroke="url(#aether-logo-gradient)"
        strokeWidth="3.4"
        strokeLinecap="round"
        opacity="0.9"
      />
      <circle cx="24" cy="24" r="3.5" fill="#f8fafc" />
      <circle cx="42" cy="34" r="5.5" fill="#f8fafc" opacity="0.92" />
      <circle cx="50" cy="20" r="2.8" fill="#7dd3fc" opacity="0.95" />
    </svg>
  );
}

function buildPresetData(type, particleCount, baseColor) {
  if (type === "supernova") {
    return createSupernovaData(particleCount);
  }

  return {
    positions: buildPresetPositions(type, particleCount),
    colors: buildPresetColors(type, particleCount, baseColor),
  };
}

function buildPresetColors(type, particleCount, baseColor) {
  if (type === "supernova") {
    return createSupernovaData(particleCount).colors;
  }

  return createSolidColors(particleCount, baseColor);
}

function buildPresetPositions(type, particleCount) {
  switch (type) {
    case "heart":
      return createHeartPositions(particleCount);
    case "saturn":
      return createSaturnPositions(particleCount);
    case "buddha":
      return createBuddhaPositions(particleCount);
    case "flower":
      return createFlowerPositions(particleCount);
    case "lotus":
      return createLotusPositions(particleCount);
    case "fireworks":
      return createFireworksPositions(particleCount);
    case "cube":
      return createCubePositions(particleCount);
    case "square":
      return createSquarePositions(particleCount);
    case "sphere":
    default:
      return createSpherePositions(particleCount);
  }
}

function createSpherePositions(particleCount) {
  const targetPositions = new Float32Array(particleCount * 3);
  const radius = 5;

  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * 3;
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const radialDistance = Math.cbrt(Math.random()) * radius;

    targetPositions[offset] = radialDistance * Math.sin(phi) * Math.cos(theta);
    targetPositions[offset + 1] = radialDistance * Math.sin(phi) * Math.sin(theta);
    targetPositions[offset + 2] = radialDistance * Math.cos(phi);
  }

  return targetPositions;
}

function createSolidColors(particleCount, hexColor) {
  const colors = new Float32Array(particleCount * 3);
  const color = new THREE.Color(hexColor);

  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * 3;
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }

  return colors;
}

function createHeartPositions(particleCount) {
  const targetPositions = new Float32Array(particleCount * 3);

  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * 3;
    const t = Math.random() * 2 * Math.PI;
    const scale = 0.3;
    const fillBias = lerp(0.72, 1, Math.sqrt(Math.random()));
    const jitter = (Math.random() - 0.5) * 0.08;

    targetPositions[offset] = 16 * Math.sin(t) ** 3 * scale * fillBias + jitter;
    targetPositions[offset + 1] =
      (13 * Math.cos(t) -
        5 * Math.cos(2 * t) -
        2 * Math.cos(3 * t) -
        Math.cos(4 * t)) *
      scale *
      fillBias +
      jitter;
    targetPositions[offset + 2] = (Math.random() - 0.5) * 0.8;
  }

  return targetPositions;
}

function createSaturnPositions(particleCount) {
  const targetPositions = new Float32Array(particleCount * 3);
  const coreCount = Math.floor(particleCount * 0.46);

  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * 3;

    if (index < coreCount) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const radialDistance = Math.cbrt(Math.random()) * 3.5;

      targetPositions[offset] = radialDistance * Math.sin(phi) * Math.cos(theta);
      targetPositions[offset + 1] = radialDistance * Math.sin(phi) * Math.sin(theta);
      targetPositions[offset + 2] = radialDistance * Math.cos(phi);
      continue;
    }

    const distance = 4.8 + Math.random() * 3.2;
    const angle = Math.random() * Math.PI * 2;
    targetPositions[offset] = Math.cos(angle) * distance;
    targetPositions[offset + 1] = (Math.random() - 0.5) * 0.6;
    targetPositions[offset + 2] = Math.sin(angle) * distance;
  }

  return targetPositions;
}

// Front-facing polar flower based on a rose curve for a clean face-on silhouette.
function createFlowerPositions(particleCount) {
  const targetPositions = new Float32Array(particleCount * 3);

  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * 3;
    const phi = Math.random() * Math.PI * 2;
    const radius = 2 * Math.cos(5 * phi) + 1;
    const fill = lerp(0.35, 1, Math.sqrt(Math.random()));

    targetPositions[offset] = radius * fill * Math.cos(phi) * 2.25;
    targetPositions[offset + 1] = radius * fill * Math.sin(phi) * 2.25;
    targetPositions[offset + 2] = (Math.random() - 0.5) * 0.75;
  }

  return targetPositions;
}

// Lotus uses layered petal crowns so the blossom reads closer to a real open flower.
function createLotusPositions(particleCount) {
  const targetPositions = new Float32Array(particleCount * 3);
  const layers = [
    { count: 8, length: 4.3, width: 1.2, rise: 0.65, curl: 0.6, offset: 0, weight: 0.46 },
    { count: 6, length: 3.4, width: 0.98, rise: 1.25, curl: 0.9, offset: Math.PI / 6, weight: 0.34 },
    { count: 4, length: 2.35, width: 0.72, rise: 1.95, curl: 1.2, offset: Math.PI / 4, weight: 0.2 },
  ];

  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * 3;
    const isCore = Math.random() < 0.12;

    if (isCore) {
      const coreRadius = Math.sqrt(Math.random()) * 0.8;
      const coreAngle = Math.random() * Math.PI * 2;
      const [volumeX, volumeY, volumeZ] = addVolume(
        Math.cos(coreAngle) * coreRadius,
        0.55 + Math.random() * 0.4,
        Math.sin(coreAngle) * coreRadius * 0.78,
        0.08,
      );

      targetPositions[offset] = volumeX;
      targetPositions[offset + 1] = volumeY;
      targetPositions[offset + 2] = volumeZ;
      continue;
    }

    const selector = Math.random();
    const layer =
      selector < layers[0].weight
        ? layers[0]
        : selector < layers[0].weight + layers[1].weight
          ? layers[1]
          : layers[2];

    const petalIndex = Math.floor(Math.random() * layer.count);
    const angle = (petalIndex / layer.count) * Math.PI * 2 + layer.offset;
    const progress = Math.sqrt(Math.random());
    const side = (Math.random() * 2 - 1) * layer.width * Math.pow(1 - progress, 0.52);
    const forward = lerp(0.28, layer.length, progress);
    const openCurve = Math.sin(progress * Math.PI) * layer.curl;
    const localX = Math.cos(angle) * forward - Math.sin(angle) * side;
    const localZ = (Math.sin(angle) * forward + Math.cos(angle) * side) * 0.78;
    const localY =
      -0.95 +
      layer.rise * progress +
      openCurve -
      Math.abs(side) * 0.16 -
      Math.pow(1 - progress, 1.6) * 0.3;
    const [volumeX, volumeY, volumeZ] = addVolume(localX, localY, localZ, 0.055);

    targetPositions[offset] = volumeX;
    targetPositions[offset + 1] = volumeY;
    targetPositions[offset + 2] = volumeZ;
  }

  return targetPositions;
}

// Buddha is sampled from a 2D silhouette mask, then extruded slightly in depth to preserve the figure.
function createBuddhaPositions(particleCount) {
  return sampleMaskShape(
    particleCount,
    [-1.32, 1.32],
    [-1.46, 1.5],
    (x, y) => buddhaMask(x, y),
    (x, y) => {
      const centered = 1 - Math.min(1, Math.abs(x) * 0.72 + Math.abs(y) * 0.16);
      return (Math.random() - 0.5) * 0.14 + centered * 0.28;
    },
  );
}

function createFireworksPositions(particleCount) {
  const targetPositions = new Float32Array(particleCount * 3);

  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * 3;
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 8;

    targetPositions[offset] = Math.cos(angle) * distance;
    targetPositions[offset + 1] = Math.sin(angle) * distance;
    targetPositions[offset + 2] = (Math.random() - 0.5) * distance;
  }

  return targetPositions;
}

function createSupernovaData(particleCount) {
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const coreColor = new THREE.Color("#ffe7b3");
  const warmCoreColor = new THREE.Color("#ffb58e");
  const haloColor = new THREE.Color("#f3f8ff");
  const armColor = new THREE.Color("#6ec5ff");
  const blueDustColor = new THREE.Color("#294b92");
  const dustColor = new THREE.Color("#d9c3c8");
  const knotColor = new THREE.Color("#ffffff");

  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * 3;
    const branch = Math.random();
    const color = new THREE.Color();
    let x;
    let y;
    let z;
    let radiusRatio;

    if (branch < 0.24) {
      const radius = Math.pow(Math.random(), 1.85) * 1.9;
      const angle = Math.random() * Math.PI * 2;
      x = Math.cos(angle) * radius * 1.08 + (Math.random() - 0.5) * 0.16;
      y = Math.sin(angle) * radius * 0.72 + (Math.random() - 0.5) * 0.14;
      z = (Math.random() - 0.5) * 0.34;
      radiusRatio = radius / 8.2;
      color.copy(coreColor).lerp(warmCoreColor, Math.random() * 0.45);
    } else if (branch < 0.68) {
      const radius = lerp(0.7, 7.6, Math.pow(Math.random(), 0.62));
      const angle = Math.random() * Math.PI * 2;
      x = Math.cos(angle) * radius * 1.42 + (Math.random() - 0.5) * 0.3;
      y = Math.sin(angle) * radius * 0.82 + (Math.random() - 0.5) * 0.26;
      z = (Math.random() - 0.5) * (0.18 + radius * 0.065);
      radiusRatio = radius / 8.2;
      color.copy(haloColor).lerp(armColor, radiusRatio * 0.7);
      if (Math.random() < 0.18) {
        color.lerp(dustColor, 0.35);
      }
    } else {
      const armIndex = Math.floor(Math.random() * 4);
      const radius = lerp(0.9, 8.2, Math.pow(Math.random(), 0.55));
      const twist = radius * 0.88;
      const angle =
        (armIndex / 4) * Math.PI * 2 +
        twist +
        (Math.random() - 0.5) * (0.14 + radius * 0.018);
      const width = (Math.random() - 0.5) * (0.2 + radius * 0.12);
      x = Math.cos(angle) * radius * 1.38 - Math.sin(angle) * width;
      y = Math.sin(angle) * radius * 0.8 + Math.cos(angle) * width * 0.82;
      z = (Math.random() - 0.5) * (0.16 + radius * 0.075);
      radiusRatio = radius / 8.2;

      color.copy(haloColor).lerp(armColor, 0.55 + radiusRatio * 0.35);
      if (Math.random() < 0.12) {
        color.lerp(knotColor, 0.55);
      }
      if (Math.random() < 0.16) {
        color.lerp(dustColor, 0.42);
      }
      if (radiusRatio > 0.6) {
        color.lerp(blueDustColor, (radiusRatio - 0.6) / 0.4);
      }
    }

    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;

    if (branch >= 0.22 && radiusRatio < 0.24) {
      color.lerp(coreColor, 0.35);
    }

    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }

  return { positions, colors };
}

function createCubePositions(particleCount) {
  const targetPositions = new Float32Array(particleCount * 3);
  const halfSize = 4.2;

  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * 3;
    const face = Math.floor(Math.random() * 6);
    const sign = face % 2 === 0 ? -halfSize : halfSize;
    const u = (Math.random() - 0.5) * halfSize * 2;
    const v = (Math.random() - 0.5) * halfSize * 2;

    if (face < 2) {
      targetPositions[offset] = sign;
      targetPositions[offset + 1] = u;
      targetPositions[offset + 2] = v;
    } else if (face < 4) {
      targetPositions[offset] = u;
      targetPositions[offset + 1] = sign;
      targetPositions[offset + 2] = v;
    } else {
      targetPositions[offset] = u;
      targetPositions[offset + 1] = v;
      targetPositions[offset + 2] = sign;
    }
  }

  return targetPositions;
}

// Square is intentionally tighter than the previous version so it reads as less zoomed-out on screen.
function createSquarePositions(particleCount) {
  const targetPositions = new Float32Array(particleCount * 3);
  const halfSize = 6.7;
  const thickness = 0.28;

  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * 3;
    const depth = (Math.random() - 0.5) * 0.2;

    // Keep the square contour dominant, then lightly seed particles inside like the heart shape.
    if (Math.random() < 0.82) {
      const edge = Math.floor(Math.random() * 4);
      const t = (Math.random() - 0.5) * halfSize * 2;
      const borderJitter = (Math.random() - 0.5) * thickness;
      const bandDrift = Math.random() < 0.28 ? (Math.random() - 0.5) * 0.8 : 0;

      if (edge === 0) {
        targetPositions[offset] = -halfSize + borderJitter;
        targetPositions[offset + 1] = t + bandDrift;
      } else if (edge === 1) {
        targetPositions[offset] = halfSize + borderJitter;
        targetPositions[offset + 1] = t + bandDrift;
      } else if (edge === 2) {
        targetPositions[offset] = t + bandDrift;
        targetPositions[offset + 1] = -halfSize + borderJitter;
      } else {
        targetPositions[offset] = t + bandDrift;
        targetPositions[offset + 1] = halfSize + borderJitter;
      }
    } else {
      const fillBias = lerp(0.72, 1, Math.sqrt(Math.random()));
      targetPositions[offset] = (Math.random() - 0.5) * halfSize * 2 * fillBias;
      targetPositions[offset + 1] = (Math.random() - 0.5) * halfSize * 2 * fillBias;
    }

    targetPositions[offset + 2] = depth;
  }

  return targetPositions;
}

function sampleMaskShape(particleCount, xRange, yRange, maskFn, zFn) {
  const targetPositions = new Float32Array(particleCount * 3);
  let accepted = 0;
  let attempts = 0;

  while (accepted < particleCount && attempts < particleCount * 40) {
    attempts += 1;
    const x = lerp(xRange[0], xRange[1], Math.random());
    const y = lerp(yRange[0], yRange[1], Math.random());

    if (!maskFn(x, y)) {
      continue;
    }

    const offset = accepted * 3;
    targetPositions[offset] = x * 4.3;
    targetPositions[offset + 1] = y * 4.3;
    targetPositions[offset + 2] = zFn(x, y) * 4.3;
    accepted += 1;
  }

  while (accepted < particleCount) {
    const offset = accepted * 3;
    targetPositions[offset] = 0;
    targetPositions[offset + 1] = 0;
    targetPositions[offset + 2] = 0;
    accepted += 1;
  }

  return targetPositions;
}

function buddhaMask(x, y) {
  const inCircle = (cx, cy, radius) => (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  const inEllipse = (cx, cy, rx, ry) =>
    ((x - cx) ** 2) / (rx ** 2) + ((y - cy) ** 2) / (ry ** 2) <= 1;
  const inRotatedEllipse = (cx, cy, rx, ry, angle) => {
    const dx = x - cx;
    const dy = y - cy;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const xr = dx * cos + dy * sin;
    const yr = -dx * sin + dy * cos;
    return (xr ** 2) / (rx ** 2) + (yr ** 2) / (ry ** 2) <= 1;
  };

  const head =
    inEllipse(0, 0.88, 0.28, 0.34) ||
    inCircle(0, 1.22, 0.12) ||
    inCircle(-0.07, 1.12, 0.085) ||
    inCircle(0.07, 1.12, 0.085) ||
    inCircle(-0.12, 1.02, 0.075) ||
    inCircle(0.12, 1.02, 0.075) ||
    inCircle(-0.17, 0.9, 0.07) ||
    inCircle(0.17, 0.9, 0.07);
  const ears = inEllipse(-0.3, 0.78, 0.08, 0.24) || inEllipse(0.3, 0.78, 0.08, 0.24);
  const neck = inEllipse(0, 0.53, 0.14, 0.11);
  const shoulders = inEllipse(0, 0.33, 0.82, 0.31);
  const torso = inEllipse(0, -0.02, 0.54, 0.68);
  const leftSleeve = inRotatedEllipse(-0.56, -0.02, 0.21, 0.44, 0.18);
  const rightSleeve = inRotatedEllipse(0.58, 0.02, 0.2, 0.42, -0.18);
  const raisedForearm = inRotatedEllipse(0.14, 0.03, 0.12, 0.31, 0.08);
  const raisedHand = inEllipse(0.16, 0.25, 0.12, 0.16);
  const fingers = inRotatedEllipse(0.2, 0.38, 0.055, 0.17, 0.04);
  const lapLeft = inRotatedEllipse(-0.5, -0.84, 0.56, 0.24, -0.26);
  const lapRight = inRotatedEllipse(0.5, -0.84, 0.56, 0.24, 0.26);
  const centerCloth = inEllipse(0, -0.72, 0.3, 0.28) || inEllipse(0, -1.0, 0.18, 0.18);
  const lowerRobe =
    inRotatedEllipse(-0.22, -0.56, 0.24, 0.2, -0.35) ||
    inRotatedEllipse(0.24, -0.48, 0.26, 0.18, 0.28) ||
    inEllipse(0.08, -0.38, 0.2, 0.12);

  const silhouette =
    head ||
    ears ||
    neck ||
    shoulders ||
    torso ||
    leftSleeve ||
    rightSleeve ||
    raisedForearm ||
    raisedHand ||
    fingers ||
    lapLeft ||
    lapRight ||
    centerCloth ||
    lowerRobe;

  return silhouette;
}

function addVolume(x, y, z, amount) {
  return [
    x + (Math.random() - 0.5) * amount,
    y + (Math.random() - 0.5) * amount,
    z + (Math.random() - 0.5) * amount,
  ];
}

function lerp(start, end, progress) {
  return start + (end - start) * progress;
}
