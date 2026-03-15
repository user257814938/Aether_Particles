"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import handsPackage from "@mediapipe/hands";
import styles from "./AetherParticles.module.css";

const { Hands } = handsPackage;

const PRESETS = {
  sphere: { label: "Sphere", color: "#3b82f6", icon: "\u25CF" },
  heart: { label: "Heart", color: "#ec4899", icon: "\u2665" },
  saturn: { label: "Saturn", color: "#fbbf24", icon: "\u{1FA90}" },
  buddha: { label: "Buddha", color: "#f97316", icon: "\u2638" },
  flower: { label: "Flower", color: "#22c55e", icon: "\u273F" },
  fireworks: { label: "Fireworks", color: "#ef4444", icon: "\u2726" },
};

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
  const [isGuideOpen, setIsGuideOpen] = useState(true);

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
      particles.rotation.y += 0.002;
      particles.rotation.x += 0.001;
      renderer.render(scene, camera);
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

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });

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
        console.error(error);
        updateForceLevel(0);
        updateStatus({
          id: "camera-error",
          tone: "error",
          text: "Acces camera refuse ou indisponible. Le preset reste visible, mais sans controle gestuel.",
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
          <div className={styles.grid}>
            {Object.entries(PRESETS).map(([key, value]) => (
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
  const targetPositions = new Float32Array(particleCount * 3);

  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * 3;
    let x = 0;
    let y = 0;
    let z = 0;

    switch (type) {
      case "sphere": {
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        x = 5 * Math.sin(phi) * Math.cos(theta);
        y = 5 * Math.sin(phi) * Math.sin(theta);
        z = 5 * Math.cos(phi);
        break;
      }
      case "heart": {
        const t = Math.random() * 2 * Math.PI;
        const scale = 0.3;
        x = 16 * Math.sin(t) ** 3 * scale;
        y =
          (13 * Math.cos(t) -
            5 * Math.cos(2 * t) -
            2 * Math.cos(3 * t) -
            Math.cos(4 * t)) *
          scale;
        z = (Math.random() - 0.5) * 2;
        break;
      }
      case "saturn": {
        if (index < particleCount * 0.4) {
          const u = Math.random();
          const v = Math.random();
          const theta = 2 * Math.PI * u;
          const phi = Math.acos(2 * v - 1);
          x = 3.5 * Math.sin(phi) * Math.cos(theta);
          y = 3.5 * Math.sin(phi) * Math.sin(theta);
          z = 3.5 * Math.cos(phi);
        } else {
          const distance = 5 + Math.random() * 3;
          const angle = Math.random() * Math.PI * 2;
          x = Math.cos(angle) * distance;
          z = Math.sin(angle) * distance;
          y = (Math.random() - 0.5) * 0.4;
        }
        break;
      }
      case "buddha": {
        const angle = Math.random() * Math.PI * 2;
        const height = (Math.random() - 0.5) * 8;
        const radius = height < -2 ? 4 : height < 1 ? 2.5 : height < 3 ? 1.5 : 1;
        x = Math.cos(angle) * radius * Math.random();
        y = height;
        z = Math.sin(angle) * radius * Math.random();
        break;
      }
      case "flower": {
        const angle = Math.random() * Math.PI * 2;
        const petals = 5;
        const radius = 5 * Math.cos(petals * angle);
        x = Math.cos(angle) * radius * Math.random();
        y = Math.sin(angle) * radius * Math.random();
        z = (Math.random() - 0.5) * 2;
        break;
      }
      case "fireworks": {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 8;
        x = Math.cos(angle) * distance;
        y = Math.sin(angle) * distance;
        z = (Math.random() - 0.5) * distance;
        break;
      }
      default:
        break;
    }

    targetPositions[offset] = x;
    targetPositions[offset + 1] = y;
    targetPositions[offset + 2] = z;
  }

  return targetPositions;
}
