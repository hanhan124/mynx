import React from "react";

/**
 * Hex shield logo with yellow lightning bolt — matches sidebar.bmp / icon.svg in main app.
 * Renders at any size via SVG.
 */
export const Logo: React.FC<{ size?: number; withShadow?: boolean }> = ({
  size = 48,
  withShadow = true,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 1024 1024"
    xmlns="http://www.w3.org/2000/svg"
    style={withShadow ? { filter: "drop-shadow(0 2px 6px rgba(14, 91, 211, 0.3))" } : undefined}
  >
    <defs>
      <linearGradient id="hexg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#7BB8FF" />
        <stop offset="100%" stopColor="#227CFF" />
      </linearGradient>
    </defs>
    {/* hex shield (outer + inner cutout) */}
    <path
      d="M512 1022c-31.7 0-63.1-8-90.9-23.2l-300-163.4A189.92 189.92 0 0 1 22 668.5v-313c0-69.6 38-133.5 99.1-166.8l300-163.4C448.9 10 480.3 2 512 2c31.7 0 63.1 8 90.9 23.2l300 163.4c61.1 33.3 99.1 97.2 99.1 166.8v313.1c0 69.6-38 133.5-99.1 166.8l-300 163.4c-27.8 15.3-59.2 23.3-90.9 23.3z m0-920c-14.8 0-29.6 3.7-43.1 11l-300 163.4c-29 15.8-46.9 46.1-46.9 79v313.1c0 33 18 63.3 46.9 79l300 163.4c27 14.7 59.2 14.7 86.1 0l300-163.4c29-15.8 46.9-46.1 46.9-79v-313c0-33-18-63.3-46.9-79L555.1 113c-13.5-7.4-28.3-11-43.1-11z"
      fill="url(#hexg)"
      stroke="#fff"
      strokeWidth={size > 32 ? 18 : 0}
    />
    {/* lightning bolt */}
    <path
      d="M725.3 389.8c-13.8-23.9-44.4-32.1-68.3-18.3l-145 83.7-145-83.7c-23.9-13.8-54.5-5.6-68.3 18.3-13.8 23.9-5.6 54.5 18.3 68.3l145 83.7v167.4c0 27.6 22.4 50 50 50s50-22.4 50-50V541.8l145-83.7c23.9-13.8 32.1-44.4 18.3-68.3z"
      fill="#FFC81E"
    />
  </svg>
);

/** Logo used inside the blue header bar (smaller, no shadow, white-stroked) */
export const HeaderLogo: React.FC = () => (
  <svg width="32" height="32" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="hexg-h" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#7BB8FF" />
        <stop offset="100%" stopColor="#227CFF" />
      </linearGradient>
    </defs>
    <path
      d="M512 1022c-31.7 0-63.1-8-90.9-23.2l-300-163.4A189.92 189.92 0 0 1 22 668.5v-313c0-69.6 38-133.5 99.1-166.8l300-163.4C448.9 10 480.3 2 512 2c31.7 0 63.1 8 90.9 23.2l300 163.4c61.1 33.3 99.1 97.2 99.1 166.8v313.1c0 69.6-38 133.5-99.1 166.8l-300 163.4c-27.8 15.3-59.2 23.3-90.9 23.3z m0-920c-14.8 0-29.6 3.7-43.1 11l-300 163.4c-29 15.8-46.9 46.1-46.9 79v313.1c0 33 18 63.3 46.9 79l300 163.4c27 14.7 59.2 14.7 86.1 0l300-163.4c29-15.8 46.9-46.1-46.9-79v-313c0-33-18-63.3-46.9-79L555.1 113c-13.5-7.4-28.3-11-43.1-11z"
      fill="url(#hexg-h)"
      stroke="#fff"
      strokeWidth="32"
    />
    <path
      d="M725.3 389.8c-13.8-23.9-44.4-32.1-68.3-18.3l-145 83.7-145-83.7c-23.9-13.8-54.5-5.6-68.3 18.3-13.8 23.9-5.6 54.5 18.3 68.3l145 83.7v167.4c0 27.6 22.4 50 50 50s50-22.4 50-50V541.8l145-83.7c23.9-13.8 32.1-44.4 18.3-68.3z"
      fill="#FFC81E"
    />
  </svg>
);