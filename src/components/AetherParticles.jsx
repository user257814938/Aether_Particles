"use client";

import { useEffect, useRef, useState } from "react";
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
  flower: { label: "Flower", color: "#e11d48", icon: "\u273F", rotation: "bloom" },
  lotus: { label: "Lotus", color: "#ec4899", icon: "\u{1FAB7}", rotation: "bloomFront" },
  fireworks: { label: "Fireworks", color: "#f97316", icon: "\u2726", rotation: "side" },
  supernova: { label: "Supernova", color: "#8b5cf6", icon: "\u273A", rotation: "side" },
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
  text: "Autorise la camera pour piloter la sculpture avec ta main.",
};

export default function AetherParticles() {
  const canvasRef = useRef(null);
  const hiddenVideoRef = useRef(null);
  const previewVideoRef = useRef(null);
  const animationFrameRef = useRef(0);
  const targetPositionsRef = useRef(new Float32Array());
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
  // The onboarding guide opens by default, then becomes user-controlled via the left panel.
  const [isGuideOpen, setIsGuideOpen] = useState(true);

  const presetSections = PRESET_SECTIONS.map((section) =>
    section.map((key) => [key, PRESETS[key]]),
  );

  useEffect(() => {
    activePresetRef.current = preset;
    if (particleCountRef.current > 0) {
      targetPositionsRef.current = buildPresetPositions(preset, particleCountRef.current);
    }
  }, [preset]);

  useEffect(() => {
    colorTargetRef.current.set(particleColor);
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

    for (let index = 0; index < positions.length; index += 1) {
      positions[index] = (Math.random() - 0.5) * 20;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      size: 0.05,
      color: PRESETS.sphere.color,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    targetPositionsRef.current = buildPresetPositions(activePresetRef.current, particleCount);

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
          text: "Tracking actif: main ouverte pour etendre, poing ferme pour regrouper.",
        });
        return;
      }

      targetExpansionRef.current = 0.8;
      updateForceLevel(0);
      updateStatus({
        id: "idle",
        tone: "neutral",
        text: "Camera active. Place ta main dans le cadre pour reprendre le controle.",
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
              text: "Le suivi de main a echoue dans cette session. Recharge la page pour reessayer.",
            });
          })
          .finally(() => {
            handRequestInFlightRef.current = false;
          });
      }

      const positionAttribute = geometry.attributes.position;
      const targetPositions = targetPositionsRef.current;
      currentExpansionRef.current +=
        (targetExpansionRef.current - currentExpansionRef.current) * 0.1;
      material.color.lerp(colorTargetRef.current, 0.05);

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
      }

      positionAttribute.needsUpdate = true;
      // Silhouettes stay readable from the front, horizontal models orbit sideways, volumetric objects spin freely.
      const rotationMode = PRESETS[activePresetRef.current].rotation;
      const time = performance.now() * 0.001;

      if (rotationMode === "full") {
        particles.rotation.y += 0.002;
        particles.rotation.x += 0.001;
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
          text: "Camera connectee. Ouvre la main pour disperser les particules.",
        });
        updateForceLevel(0);
      } catch (error) {
        updateForceLevel(0);

        const cameraMessageByError = {
          NotAllowedError:
            "Acces camera refuse. Autorise la camera dans le navigateur pour activer le controle gestuel.",
          NotReadableError:
            "La camera est deja utilisee par une autre application ou indisponible. Ferme l'autre application puis recharge la page.",
          NotFoundError:
            "Aucune camera detectee sur cet appareil. Le preset reste visible, mais sans controle gestuel.",
          AbortError:
            "Le demarrage camera a ete interrompu. Recharge la page pour reessayer.",
        };

        if (!cameraMessageByError[error?.name]) {
          console.error(error);
        }

        updateStatus({
          id: "camera-error",
          tone: "error",
          text:
            cameraMessageByError[error?.name] ??
            "Acces camera refuse ou indisponible. Le preset reste visible, mais sans controle gestuel.",
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

  return (
    <main className={styles.page}>
      <canvas ref={canvasRef} className={styles.canvas} />

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.kicker}>Hand Gesture Lab</p>
            <h1 className={styles.title}>Aether Particles</h1>
          </div>

          <button
            type="button"
            className={styles.helpButton}
            onClick={() => setIsGuideOpen(true)}
          >
            Aide ?
          </button>
        </div>

        <p className={styles.status} data-tone={status.tone}>
          {status.text}
        </p>

        <div className={styles.block}>
          <span className={styles.label}>Shape Template</span>
          <div className={styles.presetGrid}>
            {presetSections.map((section, sectionIndex) => (
              <div key={`section-${sectionIndex}`} className={styles.presetSection}>
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
            ))}
          </div>
        </div>

        <div className={styles.block}>
          <label htmlFor="particle-color" className={styles.label}>
            Core Color
          </label>
          <input
            id="particle-color"
            type="color"
            value={particleColor}
            onChange={(event) => setParticleColor(event.target.value)}
            className={styles.colorInput}
          />
        </div>

        <div className={styles.instructions}>
          <p>
            <strong>Open hand</strong>: expand particles
          </p>
          <p>
            <strong>Fist</strong>: contract and gather
          </p>
        </div>
      </section>

      {/* Bottom-left utility dock: live force feedback + camera placement preview. */}
      <div className={styles.bottomDock}>
        <section className={styles.forceCard}>
          <div className={styles.forceHeader}>
            <span className={styles.forceTitle}>Force</span>
            <span className={styles.forceValue}>{forcePercent}%</span>
          </div>

          <div className={styles.forceMeter}>
            <span className={styles.forceIcon} aria-hidden="true">
              {"\u270A"}
            </span>

            <div className={styles.forceTrack} aria-label="Jauge de force d'ouverture de la main">
              <div className={styles.forceFill} style={{ width: `${forcePercent}%` }} />
              <div className={styles.forceThumb} style={{ left: `${forcePercent}%` }} />
            </div>

            <span className={styles.forceIcon} aria-hidden="true">
              {"\u270B"}
            </span>
          </div>
        </section>

        <section className={styles.cameraCard}>
          <p className={styles.cameraLabel}>Camera</p>
          <video ref={previewVideoRef} className={styles.previewVideo} autoPlay playsInline muted />
        </section>
      </div>

      <video ref={hiddenVideoRef} className={styles.hiddenVideo} playsInline muted />

      {/* Welcome guide shown on first load and reopened later through the "Aide ?" button. */}
      <div
        className={`${styles.guideOverlay} ${
          isGuideOpen ? styles.guideOverlayVisible : styles.guideOverlayHidden
        }`}
        aria-hidden={!isGuideOpen}
      >
        <section className={styles.guideCard} role="dialog" aria-modal="true" aria-label="Guide d'accueil">
          <p className={styles.guideEyebrow}>Guide d'accueil</p>
          <h2 className={styles.guideTitle}>Comment utiliser le systeme</h2>
          <p className={styles.guideText}>
            La camera transforme l'ouverture de ta main en force. Main fermee: la jauge
            retombe. Main ouverte: la jauge monte et la sculpture se deploie.
          </p>

          <div className={styles.guideSteps}>
            <div className={styles.guideStep}>
              <span className={styles.guideStepNumber}>1</span>
              <div>
                <strong className={styles.guideStepTitle}>Autorise la camera</strong>
                <p className={styles.guideStepText}>
                  Reste visible dans l'aperçu en bas a gauche pour que le suivi reste stable.
                </p>
              </div>
            </div>

            <div className={styles.guideStep}>
              <span className={styles.guideStepNumber}>2</span>
              <div>
                <strong className={styles.guideStepTitle}>Observe la jauge</strong>
                <p className={styles.guideStepText}>
                  Elle passe de 0% a 100% selon l'ouverture de la main, entre le poing ferme et la main ouverte.
                </p>
              </div>
            </div>

            <div className={styles.guideStep}>
              <span className={styles.guideStepNumber}>3</span>
              <div>
                <strong className={styles.guideStepTitle}>Teste les modeles</strong>
                <p className={styles.guideStepText}>
                  Utilise les presets et la couleur du panneau gauche pour changer le rendu.
                </p>
              </div>
            </div>
          </div>

          <div className={styles.guideLegend}>
            <div className={styles.guideLegendItem}>
              <span className={styles.guideLegendIcon}>{"\u270A"}</span>
              <span>Poing ferme: force basse, particules contractees.</span>
            </div>
            <div className={styles.guideLegendItem}>
              <span className={styles.guideLegendIcon}>{"\u270B"}</span>
              <span>Main ouverte: force haute, particules ouvertes.</span>
            </div>
          </div>

          <div className={styles.guideActions}>
            <button type="button" className={styles.guideCloseButton} onClick={() => setIsGuideOpen(false)}>
              Commencer
            </button>
          </div>
        </section>
      </div>
    </main>
  );
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
    case "supernova":
      return createSupernovaPositions(particleCount);
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

// Lotus uses layered petals plus a bowl-like vertical curve to keep the flower readable from the front.
function createLotusPositions(particleCount) {
  const targetPositions = new Float32Array(particleCount * 3);

  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * 3;
    const theta = Math.random() * Math.PI * 2;
    const radiusProgress = Math.sqrt(Math.random());
    const radius = Math.cos(4 * theta) * radiusProgress * 2.55;
    const x = radius * Math.cos(theta);
    const y = radius * Math.sin(theta) * 0.84;
    const z = radiusProgress * radiusProgress * 0.42 - Math.abs(radius) * 0.08 - 0.08;
    const [volumeX, volumeY, volumeZ] = addVolume(x, y, z, 0.05);

    targetPositions[offset] = volumeX * 2.3;
    targetPositions[offset + 1] = volumeY * 2.3;
    targetPositions[offset + 2] = volumeZ * 1.7;
  }

  return targetPositions;
}

// Buddha is sampled from a 2D silhouette mask, then extruded slightly in depth to preserve the figure.
function createBuddhaPositions(particleCount) {
  return sampleMaskShape(
    particleCount,
    [-1.25, 1.25],
    [-1.32, 1.36],
    (x, y) => buddhaMask(x, y),
    (x, y) => {
      const centered = 1 - Math.min(1, Math.abs(x) * 0.8 + Math.abs(y) * 0.18);
      return (Math.random() - 0.5) * 0.16 + centered * 0.26;
    },
  );
}

function createFireworksPositions(particleCount) {
  const targetPositions = new Float32Array(particleCount * 3);

  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * 3;
    const burstCount = 10;
    const burstAngle = (Math.floor(Math.random() * burstCount) / burstCount) * Math.PI * 2;
    const angle = burstAngle + (Math.random() - 0.5) * 0.26;
    const distance = lerp(1.1, 7.9, Math.sqrt(Math.random()));
    const spread = 0.22 + distance * 0.035;

    targetPositions[offset] = Math.cos(angle) * distance + (Math.random() - 0.5) * spread;
    targetPositions[offset + 1] =
      Math.sin(angle) * distance + (Math.random() - 0.5) * spread;
    targetPositions[offset + 2] = (Math.random() - 0.5) * 0.7;
  }

  return targetPositions;
}

function createSupernovaPositions(particleCount) {
  const targetPositions = new Float32Array(particleCount * 3);
  const armCount = 14;

  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * 3;
    const armAngle = (Math.floor(Math.random() * armCount) / armCount) * Math.PI * 2;
    const angle = armAngle + (Math.random() - 0.5) * 0.22;
    const radius = lerp(0.25, 6.2, Math.pow(Math.random(), 0.52));
    const flare = radius * radius * 0.015;

    targetPositions[offset] = Math.cos(angle) * radius + (Math.random() - 0.5) * flare;
    targetPositions[offset + 1] = Math.sin(angle) * radius + (Math.random() - 0.5) * flare;
    targetPositions[offset + 2] = (Math.random() - 0.5) * 0.55;

    if (index < particleCount * 0.16) {
      targetPositions[offset] *= 0.38;
      targetPositions[offset + 1] *= 0.38;
      targetPositions[offset + 2] *= 0.3;
    }
  }

  return targetPositions;
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

  const head = inCircle(0, 0.86, 0.24) || inCircle(0, 1.12, 0.12);
  const shoulders = inEllipse(0, 0.44, 0.62, 0.32);
  const torso = inEllipse(0, 0.04, 0.42, 0.52);
  const arms = inEllipse(-0.46, 0.05, 0.16, 0.28) || inEllipse(0.46, 0.05, 0.16, 0.28);
  const lap = inEllipse(0, -0.54, 0.9, 0.36);
  const lotus =
    inEllipse(-0.42, -0.88, 0.34, 0.16) ||
    inEllipse(0, -0.92, 0.44, 0.18) ||
    inEllipse(0.42, -0.88, 0.34, 0.16);
  const innerGap =
    inEllipse(0, 0.2, 0.15, 0.26) && y < 0.46 && y > -0.08 && Math.abs(x) < 0.22;

  return (head || shoulders || torso || arms || lap || lotus) && !innerGap;
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
