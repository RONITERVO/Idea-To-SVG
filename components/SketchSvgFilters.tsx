import React from 'react';

const SketchSvgFilters = () => (
  <svg className="absolute w-0 h-0" aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
    <defs>
      <filter id="sketchy" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="3" result="noise" seed="2" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="pencil-texture">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" result="noise" />
        <feComposite in="SourceGraphic" in2="noise" operator="in" />
      </filter>
    </defs>
  </svg>
);

export default SketchSvgFilters;