const WHEEL_OUTCOMES = [
  { id: 1,  label: '$3 FP',     probability: 0.004,  type: 'cash',  value: 3   },
  { id: 2,  label: '$5 FP',     probability: 0.002,  type: 'cash',  value: 5   },
  { id: 3,  label: '$7 FP',     probability: 0.0002, type: 'cash',  value: 7   },
  { id: 4,  label: '$10 FP',    probability: 0.0001, type: 'cash',  value: 10  },
  { id: 5,  label: '20% Bonus', probability: 0.30,   type: 'bonus', value: 20  },
  { id: 6,  label: '15% Bonus', probability: 0.50,   type: 'bonus', value: 15  },
  { id: 7,  label: '25% Bonus', probability: 0.10,   type: 'bonus', value: 25  },
  { id: 8,  label: '30% Bonus', probability: 0.05,   type: 'bonus', value: 30  },
  { id: 9,  label: '40% Bonus', probability: 0.01,   type: 'bonus', value: 40  },
  { id: 10, label: '50% Bonus', probability: 0.007,  type: 'bonus', value: 50  },
  { id: 11, label: '69% Bonus', probability: 0.003,  type: 'bonus', value: 69  },
  { id: 12, label: '90% Bonus', probability: 0.002,  type: 'bonus', value: 90  },
  { id: 13, label: '100% Bonus',probability: 0.001,  type: 'bonus', value: 100 },
]

// Normalize so probabilities add to 1
const total = WHEEL_OUTCOMES.reduce((sum, o) => sum + o.probability, 0)
WHEEL_OUTCOMES.forEach(o => { o.probability = o.probability / total })

const spinWheel = () => {
  const rand = Math.random()
  let cumulative = 0
  for (const outcome of WHEEL_OUTCOMES) {
    cumulative += outcome.probability
    if (rand < cumulative) return outcome
  }
  return WHEEL_OUTCOMES[5]
}

module.exports = { spinWheel, WHEEL_OUTCOMES }