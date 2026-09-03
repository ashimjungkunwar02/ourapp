import { motion } from 'framer-motion'

export default function ContactPage() {
  const contacts = [
    {
      name:        'Facebook Support',
      icon:        '📘',
      description: 'Message us on Facebook',
      link:        'https://facebook.com/lisasweeps',
      handle:      '@LisaSweeps'
    },
    {
      name:        'Telegram Support',
      icon:        '✈️',
      description: 'Fast replies on Telegram',
      link:        'https://t.me/lisasweeps',
      handle:      '@LisaSweepsSupport'
    }
  ]

  return (
    <div className="p-4 max-w-lg mx-auto space-y-5">
      <h1 className="text-white font-black text-2xl">Contact Us 💬</h1>
      <p className="text-gray-400 text-sm">
        Having issues? Our support team is ready to help you 24/7.
      </p>

      {/* Contact Cards */}
      <div className="space-y-4">
        {contacts.map((c, i) => (
          <motion.a
            key={c.name}
            href={c.link}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className="flex items-center gap-4 bg-[#111] border
                       border-gray-700 rounded-2xl p-5
                       hover:border-green-500/30 transition-all
                       hover:bg-green-500/5 group"
          >
            <div className="text-4xl">{c.icon}</div>
            <div className="flex-1">
              <h3 className="text-white font-bold">{c.name}</h3>
              <p className="text-gray-400 text-sm">{c.description}</p>
              <p className="text-green-400 text-sm font-medium mt-1">
                {c.handle}
              </p>
            </div>
            <span className="text-gray-600 group-hover:text-green-400
                             transition-colors text-xl">
              →
            </span>
          </motion.a>
        ))}
      </div>

      {/* FAQ */}
      <div className="bg-[#111] border border-gray-700 rounded-2xl p-5">
        <h3 className="text-white font-bold mb-4">Quick FAQ</h3>
        <div className="space-y-4">
          {[
            [
              'How do I get coins?',
              'Claim 1 free coin every hour. Maintain a 7-day streak for bonus rewards!'
            ],
            [
              'What is FP?',
              'FP stands for Free Play — redeemable credits on the platform.'
            ],
            [
              'How do referrals work?',
              'Share your link. When friends join, you both earn bonus coins.'
            ],
            [
              'How does the wheel work?',
              'Use 1 coin to spin. Land on cash prizes or deposit bonuses!'
            ]
          ].map(([q, a]) => (
            <details key={q} className="group">
              <summary className="text-green-400 text-sm font-medium
                                  cursor-pointer hover:text-green-300
                                  transition-colors list-none flex
                                  items-center justify-between">
                {q}
                <span className="group-open:rotate-180 transition-transform
                                 text-xs">
                  ▼
                </span>
              </summary>
              <p className="text-gray-400 text-sm mt-2 pl-2 leading-relaxed">
                {a}
              </p>
            </details>
          ))}
        </div>
      </div>

      {/* Bottom note */}
      <div className="text-center">
        <p className="text-gray-600 text-xs">
          Lisa Sweeps — A World of Winners 🌍
        </p>
      </div>
    </div>
  )
}