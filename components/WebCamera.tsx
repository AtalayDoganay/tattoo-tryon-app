import React, { useEffect, useRef } from 'react';

interface WebCameraProps {
  facingMode?: 'user' | 'environment';
  style?: any;
}

export function WebCamera({ facingMode = 'user', style }: WebCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode } })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play();
        }
      })
      .catch(console.error);

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [facingMode]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
        display: 'block',
        ...style,
      }}
    />
  );
}
