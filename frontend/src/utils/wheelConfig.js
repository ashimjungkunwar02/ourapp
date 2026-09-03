export const WHEEL_SEGMENTS = [
  { id: 1,  label: '$3 FP',     color: '#FFD700', probability: 0.004,  type: 'cash',  value: 3   },
  { id: 2,  label: '$5 FP',     color: '#FF6B35', probability: 0.002,  type: 'cash',  value: 5   },
  { id: 3,  label: '$7 FP',     color: '#FF2D55', probability: 0.0002, type: 'cash',  value: 7   },
  { id: 4,  label: '$10 FP',    color: '#FF2D55', probability: 0.0001, type: 'cash',  value: 10  },
  { id: 5,  label: '20% Bonus', color: '#1DB954', probability: 0.30,   type: 'bonus', value: 20  },
  { id: 6,  label: '15% Bonus', color: '#17A847', probability: 0.50,   type: 'bonus', value: 15  },
  { id: 7,  label: '25% Bonus', color: '#16A34A', probability: 0.10,   type: 'bonus', value: 25  },
  { id: 8,  label: '30% Bonus', color: '#15803D', probability: 0.05,   type: 'bonus', value: 30  },
  { id: 9,  label: '40% Bonus', color: '#166534', probability: 0.01,   type: 'bonus', value: 40  },
  { id: 10, label: '50% Bonus', color: '#14532D', probability: 0.007,  type: 'bonus', value: 50  },
  { id: 11, label: '69% Bonus', color: '#0F4C20', probability: 0.003,  type: 'bonus', value: 69  },
  { id: 12, label: '90% Bonus', color: '#0A3B18', probability: 0.002,  type: 'bonus', value: 90  },
  { id: 13, label: '100% Bonus',color: '#052E0E', probability: 0.001,  type: 'bonus', value: 100 },
]

export const buildFullWheel = () => {
  const fillers = [
    { id: 14, label: '15% Bonus', color: '#17A847', probability: 0, type: 'bonus', value: 15 },
    { id: 15, label: '20% Bonus', color: '#1DB954', probability: 0, type: 'bonus', value: 20 },
    { id: 16, label: '15% Bonus', color: '#17A847', probability: 0, type: 'bonus', value: 15 },
    { id: 17, label: '20% Bonus', color: '#1DB954', probability: 0, type: 'bonus', value: 20 },
    { id: 18, label: '15% Bonus', color: '#17A847', probability: 0, type: 'bonus', value: 15 },
    { id: 19, label: '20% Bonus', color: '#1DB954', probability: 0, type: 'bonus', value: 20 },
    { id: 20, label: '15% Bonus', color: '#17A847', probability: 0, type: 'bonus', value: 15 },
    { id: 21, label: '20% Bonus', color: '#1DB954', probability: 0, type: 'bonus', value: 20 },
    { id: 22, label: '15% Bonus', color: '#17A847', probability: 0, type: 'bonus', value: 15 },
    { id: 23, label: '20% Bonus', color: '#1DB954', probability: 0, type: 'bonus', value: 20 },
    { id: 24, label: '15% Bonus', color: '#17A847', probability: 0, type: 'bonus', value: 15 },
  ]
  return [...WHEEL_SEGMENTS, ...fillers].slice(0, 24)
}

export const spinWheel = () => {
  const total = WHEEL_SEGMENTS.reduce((s, o) => s + o.probability, 0)
  const rand  = Math.random() * total
  let cumulative = 0
  for (const seg of WHEEL_SEGMENTS) {
    cumulative += seg.probability
    if (rand < cumulative) return seg
  }
  return WHEEL_SEGMENTS[5]
}