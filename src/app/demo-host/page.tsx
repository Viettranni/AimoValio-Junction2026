import type { Metadata } from 'next';
import { Fraunces } from 'next/font/google';

const serif = Fraunces({ subsets: ['latin', 'latin-ext'], weight: ['400', '600'], style: ['normal', 'italic'] });

export const metadata: Metadata = {
  title: 'Helsinki Juhlapalvelu · Catering (fictional demo site)',
  description: 'The fictional demo customer’s website, embedding the Aimo Planner widget with one script tag.',
};

const SERVICES = [
  { title: 'Weddings', text: 'Seated dinners and long-table buffets for 60 to 400 guests, planned with you from tasting to the last coffee.', price: 'from €46 / guest' },
  { title: 'Company lunches', text: 'Warm lunch buffets delivered to the office, with a vegetarian main every day and allergies marked on every dish.', price: 'from €19 / guest' },
  { title: 'Christmas parties', text: 'Pikkujoulu menus with our own gravlax, root vegetable casserole and rice porridge with plum kissel.', price: 'from €38 / guest' },
];

const MENU = [
  ['Smoked whitefish, rye crumb, dill cream', 'Savusiika, ruismuru, tillikerma'],
  ['Roast chicken, chanterelle sauce, jasmine rice', 'Paahdettu broileri, kanttarellikastike'],
  ['Beetroot, goat cheese, toasted hazelnut', 'Punajuuri, vuohenjuusto, hasselpähkinä'],
  ['Lingonberry cream cake', 'Puolukkakermakakku'],
];

const SNIPPET = '<script src="https://aimo.example/widget.js"\n        data-customer="helsinki-juhlapalvelu" defer></script>';

export default function DemoHostPage() {
  return (
    <div className="min-h-screen bg-[#f4efe6] text-[#1e2b26]">
      <div className="bg-[#1e2b26] px-4 py-2 text-center text-[12px] text-[#e8e1d3]">
        Fictional demo customer site. The Valio Aimo ordering assistant in the corner is added with a single script tag.
      </div>

      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <a href="#" className="flex items-baseline gap-2">
          <span className={`${serif.className} text-[24px] font-semibold tracking-[-0.01em]`}>Helsinki Juhlapalvelu</span>
          <span className="text-[12px] uppercase tracking-[0.18em] text-[#3e5b4a]">Catering</span>
        </a>
        <div className="hidden items-center gap-8 text-[14px] md:flex">
          <a href="#services" className="hover:text-[#3e5b4a]">Events</a>
          <a href="#menu" className="hover:text-[#3e5b4a]">Winter menu</a>
          <a href="#about" className="hover:text-[#3e5b4a]">About</a>
          <a href="#contact" className="rounded-full border border-[#1e2b26] px-4 py-2 hover:bg-[#1e2b26] hover:text-[#f4efe6]">
            Request a quote
          </a>
        </div>
      </nav>

      <header className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 md:grid-cols-[1.15fr_1fr]">
        <div>
          <p className="text-[13px] uppercase tracking-[0.18em] text-[#3e5b4a]">Helsinki · since 2009</p>
          <h1 className={`${serif.className} mt-4 text-[44px] leading-[1.05] tracking-[-0.02em] md:text-[60px]`}>
            Seasonal food for weddings and gatherings <em className="text-[#b4593a]">by the sea.</em>
          </h1>
          <p className="mt-6 max-w-xl text-[17px] leading-[1.6] text-[#45524c]">
            We cook for 30 to 400 guests from our kitchen on the north shore, with Finnish produce, honest portions and
            nothing left to chance on allergies.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#contact" className="rounded-full bg-[#3e5b4a] px-6 py-3 text-[15px] font-medium text-white hover:bg-[#344d3f]">
              Plan your event
            </a>
            <a href="#menu" className="rounded-full px-6 py-3 text-[15px] font-medium text-[#1e2b26] underline-offset-4 hover:underline">
              See the winter menu
            </a>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -left-6 -top-6 h-40 w-40 rounded-full bg-[#dfe6dc]" aria-hidden="true" />
          <div className="absolute -bottom-8 right-4 h-24 w-24 rounded-full bg-[#ecd5c4]" aria-hidden="true" />
          <div className="relative rotate-[1.5deg] rounded-sm bg-[#fbf8f2] px-8 py-9 shadow-[0_20px_50px_rgba(30,43,38,0.12)]">
            <p className={`${serif.className} text-center text-[13px] uppercase tracking-[0.3em] text-[#3e5b4a]`}>Wedding dinner</p>
            <p className={`${serif.className} mt-1 text-center text-[22px] italic`}>Aino &amp; Mikael</p>
            <div className="mx-auto my-5 h-px w-16 bg-[#c9bfae]" />
            <ul className="space-y-4 text-center">
              {MENU.map(([en, fi]) => (
                <li key={en}>
                  <div className="text-[15px]">{en}</div>
                  <div className="text-[12.5px] italic text-[#7a7468]">{fi}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </header>

      <section id="services" className="border-t border-[#ddd4c4] bg-[#fbf8f2]">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 md:grid-cols-3">
          {SERVICES.map((s) => (
            <article key={s.title}>
              <h2 className={`${serif.className} text-[26px] tracking-[-0.01em]`}>{s.title}</h2>
              <p className="mt-3 text-[15px] leading-[1.65] text-[#45524c]">{s.text}</p>
              <p className="mt-4 text-[13px] font-medium uppercase tracking-[0.12em] text-[#b4593a]">{s.price}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="menu" className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-12 md:grid-cols-[1fr_1.3fr]">
          <div>
            <h2 className={`${serif.className} text-[36px] leading-tight tracking-[-0.01em]`}>The winter menu</h2>
            <p className="mt-4 text-[15px] leading-[1.65] text-[#45524c]">
              Built around what Finnish farms and fishermen have in December. Every dish can be made gluten-free or
              lactose-free; tell us the numbers and we plan the rest.
            </p>
          </div>
          <ol className="divide-y divide-[#ddd4c4] border-y border-[#ddd4c4]">
            {MENU.map(([en, fi], i) => (
              <li key={en} className="flex items-baseline gap-5 py-4">
                <span className={`${serif.className} w-6 text-[15px] text-[#b4593a]`}>{String(i + 1).padStart(2, '0')}</span>
                <span className="flex-1">
                  <span className="block text-[16px]">{en}</span>
                  <span className="block text-[13px] italic text-[#7a7468]">{fi}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="about" className="bg-[#3e5b4a] text-[#f4efe6]">
        <figure className="mx-auto max-w-3xl px-6 py-20 text-center">
          <blockquote className={`${serif.className} text-[28px] leading-[1.35] tracking-[-0.01em] md:text-[32px]`}>
            “Three hundred guests, twelve of them gluten-free, and not one plate came back wrong.”
          </blockquote>
          <figcaption className="mt-6 text-[13px] uppercase tracking-[0.18em] text-[#c9d6cb]">A wedding couple, Espoo</figcaption>
        </figure>
      </section>

      <section id="contact" className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-2">
        <div>
          <h2 className={`${serif.className} text-[36px] leading-tight tracking-[-0.01em]`}>Tell us about your event</h2>
          <p className="mt-4 text-[15px] leading-[1.65] text-[#45524c]">
            Call or write and we will send a menu proposal within a day.
          </p>
          <p className="mt-6 text-[15px]">
            hello@juhlapalvelu.example
            <br />
            +358 00 000 0000
          </p>
        </div>
        <div className="rounded-lg bg-[#1e2b26] p-6 text-[#e8e1d3]">
          <p className="text-[12px] uppercase tracking-[0.16em] text-[#9fb3a6]">Under the hood</p>
          <p className="mt-2 text-[14px] leading-[1.6]">
            Our kitchen orders from Valio Aimo through the assistant in the corner. It is embedded with this one line:
          </p>
          <pre className="mt-4 overflow-x-auto rounded bg-black/30 p-4 font-mono text-[12.5px] leading-[1.6] text-[#f4efe6]">{SNIPPET}</pre>
        </div>
      </section>

      <footer className="border-t border-[#ddd4c4] px-6 py-8 text-center text-[12px] text-[#7a7468]">
        Helsinki Juhlapalvelu Oy is a fictional company made for the Aimo Planner demo.
      </footer>

      <script src="/widget.js" data-customer="helsinki-juhlapalvelu" defer />
    </div>
  );
}
