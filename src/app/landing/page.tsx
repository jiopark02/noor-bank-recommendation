'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Archivo } from 'next/font/google';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// The source design loads Archivo from Google Fonts. next/font self-hosts it
// instead, matching the precedent in src/app/waitlist/page.tsx (Manrope) so the
// root layout stays untouched. Archivo is NOT first in the stack -- the design
// puts Helvetica Neue ahead of it and only falls through to Archivo where
// Helvetica Neue is absent (Windows/Android). --archivo is spliced into that
// exact position in --font below.
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--archivo',
});

// ES5 target: avoid Array.from / iterator spread (see CLAUDE.md).
function els<T extends Element>(root: ParentNode, sel: string): T[] {
  return Array.prototype.slice.call(root.querySelectorAll(sel)) as T[];
}

type ShotEl = HTMLElement & { _tl?: gsap.core.Timeline };

export default function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const gsapReady = useRef(false);
  // Mirrors the source's `document.documentElement.classList.add('js')`, but
  // held on our own wrapper so nothing is written to <html>.
  const [js, setJs] = useState(false);

  // Layer 1: wordmark plate sizing + the global-scroll-behavior loan. Runs
  // regardless of whether GSAP is allowed to animate.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const svg = root.querySelector<SVGSVGElement>('.plate');
    const mw = root.querySelector<SVGRectElement>('.mw');
    const mt = root.querySelector<SVGTextElement>('.mt');
    const mp = root.querySelector<SVGRectElement>('.mp');
    const tag = root.querySelector<HTMLDivElement>('.mark-tag');
    if (!svg || !mw || !mt || !mp || !tag) return;

    // Size the wordmark plate to the viewport so the cutout is always centered
    // and uncropped.
    const plate = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const fs = Math.min(Math.max(w * 0.27, 92), 420);
      svg.setAttribute('viewBox', -w + ' ' + -h + ' ' + 3 * w + ' ' + 3 * h);
      [mw, mp].forEach((r) => {
        r.setAttribute('x', String(-w));
        r.setAttribute('y', String(-h));
        r.setAttribute('width', String(3 * w));
        r.setAttribute('height', String(3 * h));
      });
      mt.setAttribute('x', String(w / 2));
      mt.setAttribute('y', String(h / 2));
      mt.setAttribute('font-size', String(fs));
      mt.setAttribute('letter-spacing', (-0.06 * fs).toFixed(1));
      tag.style.top = h / 2 + fs * 0.36 + Math.max(14, w * 0.018) + 'px';
    };

    plate();

    let rt: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        plate();
        if (gsapReady.current) ScrollTrigger.refresh();
      }, 150);
    };
    window.addEventListener('resize', onResize);

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // The source sets html{scroll-behavior:smooth} globally for its in-page
    // anchors. A stylesheet rule would outlive this page, so it is applied as
    // an inline style on <html> and restored on unmount. Skipped entirely under
    // prefers-reduced-motion, matching the source's media-query override.
    const html = document.documentElement;
    const prevScrollBehavior = html.style.scrollBehavior;
    if (!reduce) {
      html.style.scrollBehavior = 'smooth';
      setJs(true);
    }

    return () => {
      clearTimeout(rt);
      window.removeEventListener('resize', onResize);
      html.style.scrollBehavior = prevScrollBehavior;
    };
  }, []);

  // Layer 2: the scroll sequence and the card demo loops. Depends on `js` so it
  // runs only after the wrapper carries the class the layout rules key off,
  // otherwise ScrollTrigger would measure the pre-collapse intro height.
  useEffect(() => {
    const root = rootRef.current;
    if (!js || !root) return;

    gsap.registerPlugin(ScrollTrigger);
    gsapReady.current = true;

    const mp = root.querySelector<SVGRectElement>('.mp');

    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              entries.forEach((e) => {
                const t = (e.target as ShotEl)._tl;
                if (!t) return;
                if (e.isIntersecting) t.play();
                else t.pause();
              });
            },
            { threshold: 0.25 }
          )
        : null;

    // gsap.context scopes every selector string below to the landing wrapper and
    // records each tween/ScrollTrigger so revert() undoes all of it. Required
    // here: next.config.js sets reactStrictMode, so this effect double-runs in
    // development and would otherwise stack duplicate pins.
    const ctx = gsap.context(() => {
      gsap.set('.mark', { opacity: 0 });
      gsap.set('.plate', { scale: 0.55 });
      gsap.set('.dark', { opacity: 0 });
      const hold = window.innerWidth <= 820 ? -76 : -48;
      gsap.set('.chev-row', { xPercent: hold - 6 });
      gsap.set('.dark-copy', { y: 40, opacity: 0 });

      // One scroll driven sequence: hero out, wordmark cut through to the black
      // panel, letters expand, panel takes over.
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: '.intro',
          start: 'top top',
          end: '+=460%',
          pin: true,
          scrub: 0.7,
          anticipatePin: 1,
        },
      });
      tl.to('.hero-copy', { y: -70, opacity: 0, duration: 0.8, ease: 'none' }, 0)
        .to('.phone', { scale: 1.3, yPercent: 50, opacity: 0, duration: 1, ease: 'none' }, 0)
        .to('.mark', { opacity: 1, duration: 0.5, ease: 'none' }, 0.55)
        .to('.plate', { scale: 1, duration: 1.7, ease: 'power2.out' }, 0.55)
        .to('.dark', { opacity: 1, duration: 0.5, ease: 'none' }, 1)
        .to('.chev-row', { xPercent: hold, duration: 2.1, ease: 'none' }, 1)
        .to('.chev-row', { xPercent: 10, duration: 2.3, ease: 'none' }, 3.1)
        .to('.plate', { scale: 7, duration: 1.5, ease: 'power2.in' }, 3.1)
        .to('.mark-tag', { opacity: 0, duration: 0.3, ease: 'none' }, 3.1)
        .to(mp, { attr: { fill: '#000' }, duration: 1, ease: 'none' }, 3.4)
        .to('.mark', { opacity: 0, duration: 0.35, ease: 'none' }, 4.4)
        .to('.dark-copy', { y: 0, opacity: 1, duration: 0.7, ease: 'none', stagger: 0.15 }, 4.55)
        .to({}, { duration: 0.6 }, 5.4);

      // Card demos. Each is a looping timeline that only plays while the card is
      // on screen.
      const GAP = 10;

      const prep = (list: HTMLElement[]) => {
        list.forEach((el) => {
          if (!el.dataset.d) el.dataset.d = getComputedStyle(el).display;
        });
        gsap.set(list, { display: 'none' });
      };

      const show = (t: gsap.core.Timeline, el: HTMLElement, pos: number, noGap?: boolean) => {
        const from: gsap.TweenVars = {
          height: 0,
          paddingTop: 0,
          paddingBottom: 0,
          autoAlpha: 0,
          y: 8,
          duration: 0.45,
          ease: 'power2.out',
          immediateRender: false,
          clearProps: 'height,overflow,marginTop,paddingTop,paddingBottom',
        };
        if (!noGap) from.marginTop = -GAP;
        t.set(el, { display: el.dataset.d, overflow: 'hidden' }, pos).from(el, from, pos);
      };

      const hideTop = (t: gsap.core.Timeline, el: HTMLElement, pos: number) => {
        t.set(el, { overflow: 'hidden' }, pos)
          .to(
            el,
            {
              height: 0,
              paddingTop: 0,
              paddingBottom: 0,
              autoAlpha: 0,
              marginBottom: -GAP,
              duration: 0.35,
              ease: 'power2.in',
            },
            pos
          )
          .set(el, {
            display: 'none',
            clearProps: 'height,overflow,marginBottom,paddingTop,paddingBottom,opacity,visibility',
          });
      };

      const fadeAll = (t: gsap.core.Timeline, list: HTMLElement[], pos?: number) => {
        t.to(list, { autoAlpha: 0, duration: 0.3, stagger: 0.04 }, pos).set(list, {
          display: 'none',
          clearProps: 'opacity,visibility,transform',
        });
      };

      const money = (n: number, pre: string) => pre + Math.round(n).toLocaleString('en-US');

      const loop = (shot: ShotEl, build: (t: gsap.core.Timeline) => void) => {
        const t = gsap.timeline({ repeat: -1, repeatDelay: 0.5, paused: !io });
        build(t);
        shot._tl = t;
        if (io) io.observe(shot);
      };

      const chat = root.querySelector<ShotEl>('.shot-chat');
      if (chat) {
        const pairs = els<HTMLElement>(chat, '.pair');
        pairs.forEach((p) => {
          p.style.display = 'contents';
        });
        loop(chat, (t) => {
          let at = 0;
          pairs.forEach((p) => {
            const q = p.querySelector<HTMLElement>('.me');
            const ty = p.querySelector<HTMLElement>('.typing');
            const a = p.querySelector<HTMLElement>('.noor');
            if (!q || !ty || !a) return;
            prep([q, ty, a]);
            show(t, q, at);
            show(t, ty, at + 0.6);
            t.set(ty, { display: 'none' }, at + 1.7);
            show(t, a, at + 1.7);
            fadeAll(t, [q, a], at + 4.4);
            at += 5;
          });
        });
      }

      const bills = root.querySelector<ShotEl>('.shot-bills');
      if (bills) {
        const brows = els<HTMLElement>(bills, '.line');
        loop(bills, (t) => {
          prep(brows);
          brows.forEach((r, i) => {
            const amt = r.querySelector<HTMLElement>('.amt');
            if (!amt) return;
            const txt = amt.textContent || '';
            const pre = txt.replace(/[\d].*$/, '');
            const num = parseFloat(txt.replace(/[^\d.]/g, ''));
            const o = { v: 0 };
            const at = i * 0.55 + (i === brows.length - 1 ? 0.5 : 0);
            show(t, r, at);
            t.to(
              o,
              {
                v: num,
                duration: 0.8,
                ease: 'power2.out',
                onUpdate: () => {
                  amt.textContent = money(o.v, pre);
                },
              },
              at
            );
          });
          fadeAll(t, brows, 5.4);
        });
      }

      const perks = root.querySelector<ShotEl>('.shot-perks');
      if (perks) {
        const chips = els<HTMLElement>(perks, '.chip');
        chips.forEach((c) => {
          c.dataset.d = 'inline-block';
        });
        loop(perks, (t) => {
          prep(chips);
          chips.forEach((c, i) => {
            const at = i * 1.1;
            show(t, c, at);
            if (i >= 3) hideTop(t, chips[i - 3], at);
          });
          fadeAll(t, chips.slice(-3), chips.length * 1.1 + 1.4);
        });
      }

      const sweep = root.querySelector<ShotEl>('.shot-sweep');
      if (sweep) {
        const srows = els<HTMLElement>(sweep, '.line');
        const big = sweep.querySelector<HTMLElement>('.big');
        if (big) {
          const so = { v: 0 };
          let total = 0;
          big.textContent = '$0';
          loop(sweep, (t) => {
            prep(srows);
            srows.forEach((r, i) => {
              const at = i * 0.8;
              const amt = parseFloat(r.dataset.sweep || '0');
              show(t, r, at, true);
              if (amt) {
                total += amt;
                const target = total;
                t.to(
                  so,
                  {
                    v: target,
                    duration: 0.7,
                    ease: 'power2.out',
                    onUpdate: () => {
                      big.textContent = money(so.v, '$');
                    },
                  },
                  at + 0.1
                );
              }
            });
            t.to({}, { duration: 3.4 });
            fadeAll(t, srows);
            t.eventCallback('onRepeat', () => {
              big.textContent = '$0';
            });
          });
        }
      }

      gsap.utils.toArray<HTMLElement>('.row').forEach((row) => {
        const st = { trigger: row, start: 'top 95%', end: 'top 55%', scrub: true };
        gsap.from(row.querySelector('.row-word'), {
          xPercent: -25,
          opacity: 0,
          ease: 'none',
          scrollTrigger: st,
        });
        gsap.from(row.querySelector('.row-arrow'), {
          xPercent: 60,
          opacity: 0,
          ease: 'none',
          scrollTrigger: st,
        });
      });
    }, root);

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (gsapReady.current) ScrollTrigger.refresh();
      });
    }

    return () => {
      gsapReady.current = false;
      if (io) io.disconnect();
      ctx.revert();
    };
  }, [js]);

  return (
    <div ref={rootRef} className={`landing ${archivo.variable}${js ? ' js' : ''}`}>
      {/* Nav. Written white on black, the page inverts it via difference blending */}
      <header className="nav">
        <a className="brand" href="#top">
          NOOR.
        </a>
        <nav className="links">
          <a href="#how">How it works</a>
          <a href="#inside">Inside Noor</a>
          <a href="#security">Security</a>
          <a href="#journal">Journal</a>
        </nav>
        <Link className="pill" href="/waitlist">
          Get early access
        </Link>
      </header>

      <main id="top">
        <section className="intro">
          <div className="layer hero">
            <div className="hero-copy">
              <h1>Money, made easy.</h1>
              <div className="tag">Noor saves for you. Automatically.</div>
              <p>
                Connect your bank. Every payday, Noor checks rent and bills, then moves what&rsquo;s
                safe into savings.
              </p>
              <Link className="btn" href="/waitlist">
                Get early access
              </Link>
            </div>
            <div className="phone" aria-hidden="true">
              <div className="screen">
                <div className="island" />
                <div className="status">
                  <span>9:41</span>
                  <span className="batt" />
                </div>
                <div className="who">Noor</div>
                <div className="day">Today</div>
                <div className="bub noor">
                  Paycheck landed. Rent and Friday&rsquo;s bills are covered, so I moved $80 into
                  savings.
                </div>
                <div className="bub me">how much this month?</div>
                <div className="bub noor">$310 so far. Want me to keep the same pace?</div>
                <div className="bub me">yes</div>
                <div className="ask">Ask anything</div>
              </div>
            </div>
          </div>

          <div className="layer mark">
            <svg
              className="plate"
              viewBox="-1440 -900 4320 2700"
              preserveAspectRatio="xMidYMid slice"
              aria-hidden="true"
              focusable="false"
            >
              <defs>
                <mask id="holes" maskUnits="userSpaceOnUse">
                  <rect
                    className="mw"
                    x="-1440"
                    y="-900"
                    width="4320"
                    height="2700"
                    fill="#fff"
                  />
                  <text
                    className="mt"
                    x="720"
                    y="450"
                    dy=".36em"
                    textAnchor="middle"
                    fontWeight="700"
                    fontSize="389"
                    letterSpacing="-23"
                    fill="#000"
                  >
                    NOOR.
                  </text>
                </mask>
              </defs>
              <rect
                className="mp"
                x="-1440"
                y="-900"
                width="4320"
                height="2700"
                fill="#fff"
                mask="url(#holes)"
              />
            </svg>
            <div className="mark-tag" aria-hidden="true">
              MONEY, MADE EASY.
            </div>
            <span className="sr-only">Noor. Money, made easy.</span>
          </div>

          <div className="layer dark">
            <p className="dark-lead dark-copy">
              It&rsquo;s knowing where you stand before you have to ask.
            </p>
            <div className="chev-row" aria-hidden="true">
              <div className="chev">
                <svg viewBox="0 0 100 100">
                  <polygon points="0,0 62,0 100,50 62,100 0,100 38,50" fill="#fff" />
                </svg>
              </div>
              <div className="chev">
                <svg viewBox="0 0 100 100">
                  <polygon points="0,0 62,0 100,50 62,100 0,100 38,50" fill="#fff" />
                </svg>
              </div>
              <div className="chev">
                <svg viewBox="0 0 100 100">
                  <polygon points="0,0 62,0 100,50 62,100 0,100 38,50" fill="#fff" />
                </svg>
              </div>
            </div>
            <h2 className="dark-copy">This isn&rsquo;t just about money.</h2>
          </div>
        </section>

        <section className="section steps" id="how">
          <h2 className="title">Money, simplified.</h2>
          <div>
            <div className="step">
              <div className="n">1</div>
              <div>
                <h3>Connect</h3>
                <p>Link your accounts once. It takes about a minute.</p>
              </div>
            </div>
            <div className="step">
              <div className="n">2</div>
              <div>
                <h3>Set the rules</h3>
                <p>Tell Noor how much to keep in checking. Change it anytime.</p>
              </div>
            </div>
            <div className="step">
              <div className="n">3</div>
              <div>
                <h3>Get paid</h3>
                <p>
                  When it lands, Noor checks rent and bills first, then moves what&rsquo;s safe into
                  savings.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="statement">
          <h2>
            Save without
            <br />
            trying.
          </h2>
          <p>
            Every payday, Noor moves what&rsquo;s safe into savings. You keep living. The number goes
            up.
          </p>
        </section>

        {/* Inside Noor. Auto-sweep leads, then three cards, each with a small drawn screen */}
        <section className="section inside" id="inside">
          <h2 className="title">Inside Noor.</h2>
          <div className="feats">
            <div className="feat lead">
              <div className="shot shot-sweep" aria-hidden="true">
                <div className="left">
                  <div className="big">$310</div>
                  <div className="small">saved this month, automatically</div>
                </div>
                <div className="log">
                  <div className="line" data-sweep="0">
                    <span>Sep 5</span>
                    <span>Paycheck landed</span>
                    <span>+$1,940</span>
                  </div>
                  <div className="line" data-sweep="80">
                    <span>Sep 5</span>
                    <span>Swept to savings</span>
                    <span>$80</span>
                  </div>
                  <div className="line" data-sweep="60">
                    <span>Sep 12</span>
                    <span>Swept to savings</span>
                    <span>$60</span>
                  </div>
                  <div className="line" data-sweep="0">
                    <span>Sep 19</span>
                    <span>Rent due, kept in checking</span>
                    <span>$0</span>
                  </div>
                  <div className="line" data-sweep="170">
                    <span>Sep 26</span>
                    <span>Swept to savings</span>
                    <span>$170</span>
                  </div>
                </div>
              </div>
              <h3>Auto-sweep</h3>
              <p>
                Every payday, Noor checks rent and bills, then moves what&rsquo;s safe into savings.
                You set the floor. It does the rest.
              </p>
            </div>
            <div className="feat">
              <div className="shot shot-chat" aria-hidden="true">
                <div className="pair">
                  <div className="bub me">Can I afford this?</div>
                  <div className="typing" data-d="flex">
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="bub noor">Yes. $212 left after rent.</div>
                </div>
                <div className="pair x">
                  <div className="bub me">What&rsquo;s this $23 charge?</div>
                  <div className="typing" data-d="flex">
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="bub noor">Your gym. Renewed Tuesday.</div>
                </div>
              </div>
              <h3>Ask</h3>
              <p>Plain English in, real answers out.</p>
            </div>
            <div className="feat">
              <div className="shot shot-bills" aria-hidden="true">
                <div className="line">
                  <span>Rent</span>
                  <span>Sep 1</span>
                  <span className="amt">$1,450</span>
                </div>
                <div className="line">
                  <span>Paycheck</span>
                  <span>Sep 5</span>
                  <span className="amt">+$1,940</span>
                </div>
                <div className="line">
                  <span>Card</span>
                  <span>Sep 12</span>
                  <span className="amt">$310</span>
                </div>
                <div className="line sum">
                  <span>Safe to spend</span>
                  <span />
                  <span className="amt">$180</span>
                </div>
              </div>
              <h3>Bills and paydays</h3>
              <p>Everything due and everything coming, in one view.</p>
            </div>
            <div className="feat">
              <div className="shot shot-perks" aria-hidden="true">
                <div className="chip fill">15% off this week</div>
                <div className="chip">Drop, Sat 10am</div>
                <div className="chip x">Free shipping today</div>
                <div className="chip fill x">Early access, Fri</div>
                <div className="chip x">2 for 1 tonight</div>
                <div className="chip fill x">New drop, 24h</div>
              </div>
              <h3>Perks</h3>
              <p>Drops and deals from brands you already like.</p>
            </div>
          </div>
        </section>

        {/* Ask anything. Two marquee rows of real questions */}
        <section className="section askany">
          <h2 className="title">Ask anything.</h2>
          <p className="sub">Real questions, answered from your own accounts.</p>
          <ul className="sr-only">
            <li>Did my paycheck land?</li>
            <li>How much did you save me this month?</li>
            <li>What&rsquo;s this $23 charge?</li>
            <li>How much can I spend today?</li>
            <li>Pause saving until rent clears</li>
            <li>Am I overpaying for subscriptions?</li>
            <li>Why did you sweep $80?</li>
            <li>When is my card due?</li>
            <li>Can I afford the concert?</li>
            <li>Can I do Cabo in March?</li>
            <li>What&rsquo;s left after bills?</li>
            <li>Keep $500 in checking from now on</li>
          </ul>
          <div className="marquee" aria-hidden="true">
            <div className="track">
              <span className="q">Did my paycheck land?</span>
              <span className="q k">How much did you save me this month?</span>
              <span className="q">What&rsquo;s this $23 charge?</span>
              <span className="q">How much can I spend today?</span>
              <span className="q k">Pause saving until rent clears</span>
              <span className="q">Am I overpaying for subscriptions?</span>
              <span className="q">Did my paycheck land?</span>
              <span className="q k">How much did you save me this month?</span>
              <span className="q">What&rsquo;s this $23 charge?</span>
              <span className="q">How much can I spend today?</span>
              <span className="q k">Pause saving until rent clears</span>
              <span className="q">Am I overpaying for subscriptions?</span>
            </div>
          </div>
          <div className="marquee rev" aria-hidden="true">
            <div className="track">
              <span className="q k">Why did you sweep $80?</span>
              <span className="q">When is my card due?</span>
              <span className="q">Can I afford the concert?</span>
              <span className="q k">Can I do Cabo in March?</span>
              <span className="q">What&rsquo;s left after bills?</span>
              <span className="q">Keep $500 in checking from now on</span>
              <span className="q k">Why did you sweep $80?</span>
              <span className="q">When is my card due?</span>
              <span className="q">Can I afford the concert?</span>
              <span className="q k">Can I do Cabo in March?</span>
              <span className="q">What&rsquo;s left after bills?</span>
              <span className="q">Keep $500 in checking from now on</span>
            </div>
          </div>
        </section>

        {/* How Noor is different. Sliding statements on black */}
        <section className="section help" id="help">
          <h2 className="title">How Noor is different.</h2>
          <div className="rows">
            <div className="row">
              <div className="row-word">No jargon</div>
              <p>Plain English, both ways.</p>
              <div className="row-arrow" aria-hidden="true">
                <svg
                  viewBox="0 0 100 60"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 30h88M70 8l22 22-22 22" />
                </svg>
              </div>
            </div>
            <div className="row">
              <div className="row-word">No spreadsheets</div>
              <p>Your plan builds itself from your accounts.</p>
              <div className="row-arrow" aria-hidden="true">
                <svg
                  viewBox="0 0 100 60"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 30h88M70 8l22 22-22 22" />
                </svg>
              </div>
            </div>
            <div className="row">
              <div className="row-word">No willpower</div>
              <p>Saving happens before you can spend it.</p>
              <div className="row-arrow" aria-hidden="true">
                <svg
                  viewBox="0 0 100 60"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 30h88M70 8l22 22-22 22" />
                </svg>
              </div>
            </div>
          </div>
        </section>

        {/* Founder note */}
        <section className="section note">
          <div className="who">A note from the founder</div>
          <div>
            <blockquote>
              Nobody teaches you this. The first paycheck lands, rent goes out, and you&rsquo;re
              guessing. Noor is the friend who&rsquo;s good with money, and does the saving for you.
            </blockquote>
            <div className="sig">
              Jin Park<span>Founder, Noor</span>
            </div>
          </div>
        </section>

        <section className="section secure" id="security">
          <div className="head">
            <div>
              <h2 className="title">Your data, yours.</h2>
              <p className="sub">
                Noor only moves money inside the rules you set. It never shares your login and never
                keeps what you delete.
              </p>
            </div>
            <a className="more" href="#security">
              Security details
            </a>
          </div>
          <div className="badges">
            <div className="badge">
              <svg viewBox="0 0 28 28" fill="none" stroke="#000" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 8h20M4 20h20" />
                <circle cx="18" cy="8" r="3" fill="#fff" />
                <circle cx="10" cy="20" r="3" fill="#fff" />
              </svg>
              <h3>Your rules</h3>
              <p>
                You set a floor for checking. Noor never sweeps below it, and never moves money
                anywhere you didn&rsquo;t choose.
              </p>
            </div>
            <div className="badge">
              <svg
                viewBox="0 0 28 28"
                fill="none"
                stroke="#000"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              >
                <path d="M11 17l6-6M9 13l-3 3a4 4 0 0 0 6 6l3-3M19 15l3-3a4 4 0 0 0-6-6l-3 3" />
              </svg>
              <h3>Plaid connection</h3>
              <p>Your bank login goes to Plaid, not to Noor. We only see what you allow.</p>
            </div>
            <div className="badge">
              <svg viewBox="0 0 28 28" fill="none" stroke="#000" strokeWidth="1.5" strokeLinejoin="round">
                <rect x="5" y="12" width="18" height="12" rx="2" />
                <path d="M9 12V9a5 5 0 0 1 10 0v3" />
              </svg>
              <h3>Encrypted</h3>
              <p>Your data is encrypted in transit and at rest.</p>
            </div>
            <div className="badge">
              <svg
                viewBox="0 0 28 28"
                fill="none"
                stroke="#000"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              >
                <path d="M5 8h18M11 8V5h6v3M8 8l1 15h10l1-15M12 12v7M16 12v7" />
              </svg>
              <h3>Pause or delete</h3>
              <p>Pause sweeps with one tap. Disconnect a bank or delete everything, anytime.</p>
            </div>
          </div>
        </section>

        <section className="section journal" id="journal">
          <div className="head">
            <h2 className="title">Journal</h2>
            <a className="more" href="#journal">
              All posts
            </a>
          </div>
          <div className="grid3">
            <a className="post" href="#journal">
              <div className="img" aria-hidden="true">
                $
              </div>
              <h3>Your first paycheck, explained.</h3>
              <p>4 min read</p>
            </a>
            <a className="post" href="#journal">
              <div className="img" aria-hidden="true">
                ÷
              </div>
              <h3>Splitting rent without the group chat fight.</h3>
              <p>3 min read</p>
            </a>
            <a className="post" href="#journal">
              <div className="img" aria-hidden="true">
                %
              </div>
              <h3>What a credit score actually measures.</h3>
              <p>5 min read</p>
            </a>
          </div>
        </section>

        <section className="cta" id="cta">
          <h2>Get in early.</h2>
          <p>The beta is opening soon. Leave your email and we&rsquo;ll let you know.</p>
          <Link className="btn" href="/waitlist">
            Get early access
          </Link>
          <p className="fine">One email when it opens. Nothing else.</p>
        </section>
      </main>

      <footer>
        <div className="fcols">
          <div>
            <h4>NOOR.</h4>
            <p>Noor saves for you, automatically. Money, made easy.</p>
          </div>
          <div>
            <h4>Product</h4>
            <a href="#how">How it works</a>
            <a href="#inside">Inside Noor</a>
            <a href="#security">Security</a>
            <a href="#cta">Early access</a>
          </div>
          <div>
            <h4>Company</h4>
            <a href="#top">About</a>
            <a href="#journal">Journal</a>
            <a href="#top">Careers</a>
            <a href="#top">Contact</a>
          </div>
          <div>
            <h4>Legal</h4>
            <a href="#top">Privacy</a>
            <a href="#top">Terms</a>
          </div>
        </div>
        <div className="legal">
          <span>© 2026 Rindaman Inc.</span>
          <span>Made in Seoul and Berkeley.</span>
        </div>
        <div className="fmark" aria-hidden="true">
          NOOR.
        </div>
      </footer>

      {/*
        Scoped, NOT global. styled-jsx (repo precedent: MapView.tsx) rewrites
        every selector below with a per-component class, and every rule is
        additionally written under .landing. The source's document-level rules
        (:root variables, the * reset, and body) are hoisted onto .landing so
        nothing survives navigation away from this page.
      */}
      <style jsx>{`
        .landing {
          /* Source :root variables, verbatim. --archivo is supplied by
             next/font on this same element and spliced into --font at the
             position Archivo occupies in the source stack. */
          --white: #ffffff;
          --black: #000000;
          --grey: #6b6b6b;
          --line: #e5e5e5;
          --soft: #f2f2f2;
          --dgrey: #9a9a9a;
          --dline: #2a2a2a;
          --font: 'Helvetica Neue', var(--archivo), Helvetica, Arial, sans-serif;
          --pad: max(clamp(20px, 4vw, 56px), calc((100vw - 1680px) / 2));
          --ease: cubic-bezier(0.2, 0.7, 0.2, 1);

          /* Source body{} rules, hoisted onto the wrapper. */
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          font-family: var(--font);
          color: var(--black);
          background: var(--white);
          line-height: 1.4;
          font-size: 17px;
          /* globals.css sets body{letter-spacing:-.01em}, which would inherit in
             and tighten every line. The source body has no letter-spacing. */
          letter-spacing: normal;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          /* Source used body{overflow-x:hidden}. On a non-root element that
             computes overflow-y to auto, which makes .steps .title{position:
             sticky} dead and gives ScrollTrigger a second scroller. clip does
             the same horizontal clipping without creating a scroll container. */
          overflow-x: clip;
        }
        .landing * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        .landing a {
          color: inherit;
          text-decoration: none;
        }
        .landing button {
          font: inherit;
        }
        .landing h1,
        .landing h2,
        .landing h3 {
          font-weight: 700;
          letter-spacing: -0.04em;
          line-height: 1;
          text-wrap: balance;
        }
        .landing ::selection {
          background: #000;
          color: #fff;
        }
        .landing .help ::selection,
        .landing .cta ::selection,
        .landing .dark ::selection,
        .landing .shot ::selection {
          background: #fff;
          color: #000;
        }
        .landing :focus-visible {
          outline: 2px solid currentColor;
          outline-offset: 4px;
        }
        .landing svg {
          display: block;
        }
        .landing .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }

        /* Nav. Written white on black, the page inverts it via difference blending */
        .landing .nav {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px var(--pad);
          mix-blend-mode: difference;
          color: #fff;
        }
        .landing .brand {
          font-weight: 700;
          letter-spacing: -0.03em;
          font-size: 20px;
        }
        .landing .links {
          display: flex;
          gap: 28px;
          font-size: 14px;
          font-weight: 500;
        }
        .landing .links a {
          opacity: 0.72;
          transition: opacity 0.25s var(--ease);
        }
        .landing .links a:hover {
          opacity: 1;
        }
        .landing .pill {
          background: #fff;
          color: #000;
          border: 0;
          border-radius: 999px;
          padding: 10px 18px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.25s var(--ease);
        }
        .landing .pill:hover {
          background: #e3e3e3;
        }

        .landing .btn {
          display: inline-flex;
          align-items: center;
          background: #000;
          color: #fff;
          border: 0;
          border-radius: 999px;
          padding: 14px 24px;
          font-size: 15px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.25s var(--ease), transform 0.25s var(--ease);
        }
        .landing .btn:hover {
          background: #1f1f1f;
        }
        .landing .btn:active {
          transform: scale(0.98);
        }

        /* Intro. Three layers: hero (1), black panel (2), white plate with the wordmark cut out (3) */
        .landing .intro {
          position: relative;
        }
        .landing .layer {
          position: relative;
          min-height: 100vh;
          min-height: 100svh;
          overflow: hidden;
        }
        .landing.js .intro {
          height: 100vh;
          height: 100svh;
          overflow: hidden;
        }
        .landing.js .layer {
          position: absolute;
          inset: 0;
          height: 100%;
          min-height: 0;
        }
        .landing.js .mark,
        .landing.js .dark {
          pointer-events: none;
        }

        .landing .hero {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: clamp(100px, 15vh, 170px) var(--pad) 0;
          z-index: 1;
        }
        .landing .hero-copy {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .landing .hero h1 {
          font-size: clamp(44px, 7.6vw, 120px);
          line-height: 0.94;
          letter-spacing: -0.045em;
          max-width: 18ch;
        }
        .landing .hero .tag {
          margin-top: 18px;
          font-size: clamp(18px, 1.7vw, 24px);
          letter-spacing: -0.02em;
          font-weight: 500;
        }
        .landing .hero p {
          margin-top: 12px;
          color: var(--grey);
          font-size: clamp(15px, 1.2vw, 18px);
          max-width: 38ch;
        }
        .landing .hero .btn {
          margin-top: 26px;
        }

        .landing .phone {
          /* Size reflects BOTH viewport axes, tighter constraint wins, with an
             absolute ceiling. The source used height:68vh alone, so the phone
             tracked viewport height only: its share of viewport width swung
             14.5%-37.1% across window shapes. 52vw caps the phone at 24% of
             viewport width, 660px stops it ballooning on large displays. On
             common laptop ratios (1280x720, 1440x900) the vh term still wins,
             so those are unchanged. */
          --phone-h: min(68vh, 52vw, 660px);
          /* 24/68 -- the source's crop fraction, kept exactly. Anchored to the
             phone's own height rather than vh so the amount hanging below the
             fold stays a constant share of the phone once width can drive the
             size. A literal bottom:-24vh would crop 55% of the phone on a tall
             narrow window and 25% on a short wide one. */
          --phone-crop: 0.353;
          position: absolute;
          left: 0;
          right: 0;
          bottom: calc(var(--phone-h) * var(--phone-crop) * -1);
          margin: 0 auto;
          height: var(--phone-h);
          width: auto;
          /* No max-width: with height definite, a max-width clamp would narrow
             the box without recomputing height, breaking the 9/19.5 ratio. The
             width limit lives in --phone-h instead. */
          aspect-ratio: 9 / 19.5;
          background: #000;
          border-radius: 52px;
          padding: 11px;
          box-shadow: 0 50px 100px rgba(0, 0, 0, 0.16);
          transform-origin: 50% 100%;
        }
        .landing .screen {
          position: relative;
          height: 100%;
          background: #fff;
          border-radius: 42px;
          padding: 78px 16px 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          font-size: 14px;
          overflow: hidden;
          text-align: left;
        }
        .landing .island {
          position: absolute;
          top: 12px;
          left: 50%;
          width: 86px;
          height: 26px;
          margin-left: -43px;
          background: #000;
          border-radius: 999px;
        }
        .landing .status {
          position: absolute;
          top: 17px;
          left: 28px;
          right: 28px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
          font-weight: 600;
        }
        .landing .batt {
          width: 24px;
          height: 12px;
          border: 1.5px solid #000;
          border-radius: 4px;
          position: relative;
        }
        .landing .batt::after {
          content: '';
          position: absolute;
          inset: 2px;
          background: #000;
          border-radius: 1px;
        }
        .landing .screen .who {
          text-align: center;
          font-weight: 700;
          font-size: 13px;
          margin-top: -10px;
        }
        .landing .screen .day {
          text-align: center;
          color: var(--grey);
          font-size: 11px;
        }
        .landing .bub {
          max-width: 84%;
          padding: 11px 14px;
          border-radius: 19px;
          line-height: 1.35;
          letter-spacing: -0.01em;
        }
        .landing .bub.me {
          align-self: flex-end;
          background: #000;
          color: #fff;
          border-bottom-right-radius: 6px;
        }
        .landing .bub.noor {
          align-self: flex-start;
          border: 1px solid var(--line);
          border-bottom-left-radius: 6px;
        }
        .landing .screen .ask {
          margin-top: auto;
          border: 1px solid var(--line);
          border-radius: 999px;
          padding: 12px 16px;
          color: var(--grey);
          font-size: 13px;
        }

        .landing .mark {
          z-index: 3;
          background: #000;
        }
        .landing.js .mark {
          background: transparent;
        }
        .landing .plate {
          position: absolute;
          left: -100%;
          top: -100%;
          width: 300%;
          height: 300%;
          transform-origin: 50% 50%;
          will-change: transform;
        }
        /* The source set this stack as a presentation attribute on <text>. It is
           a CSS rule here so the next/font family reaches the mask glyphs. */
        .landing .plate .mt {
          font-family: var(--font);
        }
        .landing .mark-tag {
          position: absolute;
          left: 0;
          right: 0;
          top: calc(50% + 15vw);
          text-align: center;
          letter-spacing: 0.34em;
          font-size: clamp(11px, 1.1vw, 14px);
          font-weight: 500;
          padding-left: 0.34em;
        }

        .landing .dark {
          background: #000;
          color: #fff;
          display: grid;
          grid-template-rows: auto 1fr auto;
          padding: clamp(90px, 12vh, 140px) var(--pad) clamp(40px, 7vh, 80px);
          z-index: 2;
        }
        .landing .dark-lead {
          justify-self: end;
          text-align: right;
          max-width: 28ch;
          color: var(--dgrey);
          font-size: clamp(15px, 1.3vw, 18px);
        }
        .landing .chev-row {
          display: flex;
          align-items: center;
          gap: 2vw;
          width: 150vw;
          margin-left: -22vw;
          align-self: center;
        }
        .landing .chev {
          flex: none;
          width: 34vw;
        }
        .landing .chev svg {
          width: 100%;
          height: auto;
        }
        .landing .dark h2 {
          font-size: clamp(34px, 4.8vw, 74px);
          max-width: 13ch;
        }

        /* Sections */
        .landing .section {
          padding: clamp(80px, 12vh, 160px) var(--pad);
        }
        .landing .title {
          font-size: clamp(36px, 4.6vw, 72px);
        }
        .landing .sub {
          margin-top: 16px;
          color: var(--grey);
          max-width: 40ch;
          font-size: clamp(16px, 1.3vw, 19px);
        }
        .landing .more {
          font-size: 14px;
          font-weight: 500;
          border-bottom: 1px solid currentColor;
          padding-bottom: 2px;
          white-space: nowrap;
          transition: opacity 0.25s var(--ease);
        }
        .landing .more:hover {
          opacity: 0.6;
        }

        .landing .steps {
          display: grid;
          grid-template-columns: 1fr 1.4fr;
          gap: clamp(32px, 6vw, 96px);
          align-items: start;
        }
        .landing .steps .title {
          position: sticky;
          top: 120px;
        }
        .landing .step {
          display: grid;
          grid-template-columns: 52px 1fr;
          gap: 16px;
          padding: 30px 0;
          border-top: 1px solid var(--line);
        }
        .landing .step:last-child {
          border-bottom: 1px solid var(--line);
        }
        .landing .step .n {
          font-size: 14px;
          color: var(--grey);
          padding-top: 8px;
          font-variant-numeric: tabular-nums;
        }
        .landing .step h3 {
          font-size: clamp(24px, 2.4vw, 34px);
          letter-spacing: -0.03em;
        }
        .landing .step p {
          color: var(--grey);
          margin-top: 8px;
          max-width: 40ch;
        }

        .landing .statement {
          padding: clamp(110px, 18vh, 240px) var(--pad);
          border-top: 1px solid var(--line);
        }
        .landing .statement h2 {
          font-size: clamp(56px, 10.5vw, 176px);
          letter-spacing: -0.055em;
          line-height: 0.9;
        }
        .landing .statement p {
          margin-top: 30px;
          color: var(--grey);
          max-width: 36ch;
          font-size: clamp(16px, 1.3vw, 19px);
        }

        /* Inside Noor. Auto-sweep leads, then three cards, each with a small drawn screen */
        .landing .inside {
          border-top: 1px solid var(--line);
        }
        .landing .feats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: clamp(14px, 1.8vw, 28px);
          margin-top: clamp(36px, 6vh, 64px);
        }
        .landing .feat.lead {
          grid-column: 1 / -1;
        }
        .landing .feat .shot {
          background: #000;
          color: #fff;
          aspect-ratio: 4 / 5;
          padding: clamp(18px, 1.6vw, 26px);
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          gap: 10px;
          font-size: clamp(13px, 0.95vw, 15px);
          letter-spacing: -0.01em;
          overflow: hidden;
          font-variant-numeric: tabular-nums;
        }
        .landing .feat.lead .shot {
          aspect-ratio: auto;
          min-height: clamp(300px, 44vh, 500px);
          flex-direction: row;
          align-items: flex-end;
          justify-content: space-between;
          gap: clamp(24px, 4vw, 72px);
          padding: clamp(24px, 2.4vw, 40px);
        }
        .landing .feat h3 {
          margin-top: 18px;
          font-size: clamp(20px, 1.8vw, 26px);
          letter-spacing: -0.03em;
        }
        .landing .feat p {
          color: var(--grey);
          margin-top: 8px;
          max-width: 26ch;
          font-size: 15px;
        }
        .landing .feat.lead p {
          max-width: 44ch;
        }
        .landing .shot .left {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .landing .shot .big {
          font-size: clamp(44px, 4.2vw, 64px);
          font-weight: 700;
          letter-spacing: -0.05em;
          line-height: 0.9;
        }
        .landing .feat.lead .shot .big {
          font-size: clamp(88px, 11vw, 180px);
        }
        .landing .shot .small {
          color: var(--dgrey);
        }
        .landing .shot .log {
          flex: 0 1 46%;
          min-width: 280px;
        }
        .landing .shot .line {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 14px;
          padding: 10px 0;
          border-top: 1px solid var(--dline);
        }
        .landing .shot .line:first-child {
          border-top: 0;
        }
        .landing .shot .line span:nth-child(2) {
          color: var(--dgrey);
        }
        .landing .shot .line span:last-child {
          text-align: right;
        }
        .landing .shot .log .line {
          grid-template-columns: auto 1fr auto;
        }
        .landing .shot .log .line span:first-child {
          color: var(--dgrey);
        }
        .landing .shot .log .line span:nth-child(2) {
          color: #fff;
        }
        .landing .shot .bub {
          max-width: 88%;
          padding: 10px 13px;
          border-radius: 16px;
        }
        .landing .shot .bub.me {
          background: #fff;
          color: #000;
          border-bottom-right-radius: 5px;
        }
        .landing .shot .bub.noor {
          border: 1px solid #444;
          color: #fff;
          border-bottom-left-radius: 5px;
        }
        .landing .shot .chip {
          display: inline-block;
          align-self: flex-start;
          border: 1px solid #fff;
          border-radius: 999px;
          padding: 8px 14px;
        }
        .landing .shot .chip.fill {
          background: #fff;
          color: #000;
        }
        .landing .shot .line.sum {
          border-top: 1px solid #fff;
          font-weight: 700;
        }
        .landing .shot .line.sum span:nth-child(2) {
          color: #fff;
        }
        .landing .pair {
          display: contents;
        }
        .landing .pair.x,
        .landing .chip.x,
        .landing .typing {
          display: none;
        }
        .landing .typing {
          align-self: flex-start;
          gap: 5px;
          padding: 13px 14px;
          border: 1px solid #444;
          border-radius: 16px;
          border-bottom-left-radius: 5px;
        }
        .landing .typing i {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #fff;
          animation: blink 1s infinite;
        }
        .landing .typing i:nth-child(2) {
          animation-delay: 0.18s;
        }
        .landing .typing i:nth-child(3) {
          animation-delay: 0.36s;
        }
        @keyframes blink {
          0%,
          100% {
            opacity: 0.25;
          }
          50% {
            opacity: 1;
          }
        }

        /* Ask anything. Two marquee rows of real questions */
        .landing .askany {
          border-top: 1px solid var(--line);
          padding-left: 0;
          padding-right: 0;
        }
        .landing .askany .title,
        .landing .askany .sub {
          padding-left: var(--pad);
          padding-right: var(--pad);
        }
        .landing .marquee {
          overflow: hidden;
          margin-top: clamp(36px, 6vh, 64px);
          -webkit-mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
          mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
        }
        .landing .marquee + .marquee {
          margin-top: 14px;
        }
        .landing .track {
          display: flex;
          width: max-content;
          animation: slide 48s linear infinite;
          will-change: transform;
        }
        .landing .marquee.rev .track {
          animation-direction: reverse;
        }
        .landing .marquee:hover .track {
          animation-play-state: paused;
        }
        .landing .q {
          flex: none;
          border: 1px solid var(--line);
          border-radius: 999px;
          padding: 16px 26px;
          margin-right: 14px;
          font-size: clamp(17px, 1.6vw, 24px);
          letter-spacing: -0.02em;
          white-space: nowrap;
        }
        .landing .q.k {
          background: #000;
          color: #fff;
          border-color: #000;
        }
        @keyframes slide {
          to {
            transform: translateX(-50%);
          }
        }

        /* How Noor is different. Sliding statements on black */
        .landing .help {
          background: #000;
          color: #fff;
        }
        .landing .help .title {
          font-size: clamp(28px, 3.2vw, 46px);
          max-width: 14ch;
        }
        .landing .rows {
          margin-top: clamp(36px, 6vh, 64px);
        }
        .landing .row {
          display: grid;
          grid-template-columns: 1.6fr 1fr auto;
          align-items: center;
          gap: clamp(20px, 4vw, 64px);
          padding: clamp(28px, 4vh, 48px) 0;
          border-top: 1px solid var(--dline);
        }
        .landing .row:last-child {
          border-bottom: 1px solid var(--dline);
        }
        .landing .row-word {
          font-size: clamp(40px, 6.6vw, 108px);
          letter-spacing: -0.055em;
          line-height: 0.9;
          font-weight: 700;
        }
        .landing .row p {
          color: var(--dgrey);
          font-size: clamp(15px, 1.3vw, 18px);
          max-width: 30ch;
        }
        .landing .row-arrow {
          width: clamp(48px, 6vw, 92px);
        }
        .landing .row-arrow svg {
          width: 100%;
          height: auto;
        }

        /* Founder note */
        .landing .note {
          display: grid;
          grid-template-columns: 1fr 2fr;
          gap: clamp(32px, 6vw, 96px);
          border-top: 1px solid var(--line);
        }
        .landing .note .who {
          color: var(--grey);
          font-size: 15px;
        }
        .landing .note blockquote {
          font-size: clamp(24px, 3vw, 44px);
          letter-spacing: -0.035em;
          line-height: 1.1;
          font-weight: 700;
          max-width: 22ch;
          text-wrap: balance;
        }
        .landing .note .sig {
          margin-top: 28px;
          font-size: 15px;
        }
        .landing .note .sig span {
          display: block;
          color: var(--grey);
        }

        /* Security */
        .landing .secure {
          border-top: 1px solid var(--line);
        }
        .landing .head {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 24px;
        }
        .landing .badges {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: clamp(20px, 3vw, 48px);
          margin-top: clamp(36px, 6vh, 64px);
        }
        .landing .badge {
          border-top: 1px solid #000;
          padding-top: 22px;
        }
        .landing .badge svg {
          width: 28px;
          height: 28px;
        }
        .landing .badge h3 {
          margin-top: 26px;
          font-size: clamp(20px, 1.8vw, 26px);
          letter-spacing: -0.03em;
        }
        .landing .badge p {
          color: var(--grey);
          margin-top: 10px;
          font-size: 15px;
          max-width: 26ch;
        }

        /* Journal */
        .landing .journal {
          border-top: 1px solid var(--line);
        }
        .landing .grid3 {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: clamp(16px, 2.2vw, 36px);
          margin-top: clamp(36px, 6vh, 64px);
        }
        .landing .post .img {
          background: var(--soft);
          aspect-ratio: 4 / 3;
          display: grid;
          place-items: center;
          font-size: clamp(64px, 7vw, 120px);
          font-weight: 700;
          letter-spacing: -0.05em;
          transition: background 0.3s var(--ease);
        }
        .landing .post:hover .img {
          background: #e9e9e9;
        }
        .landing .post h3 {
          margin-top: 16px;
          font-size: clamp(18px, 1.7vw, 24px);
          letter-spacing: -0.025em;
          line-height: 1.15;
          max-width: 22ch;
        }
        .landing .post:hover h3 {
          text-decoration: underline;
          text-underline-offset: 0.14em;
          text-decoration-thickness: 1px;
        }
        .landing .post p {
          color: var(--grey);
          font-size: 14px;
          margin-top: 8px;
        }

        /* Final call */
        .landing .cta {
          background: #000;
          color: #fff;
          padding: clamp(110px, 18vh, 220px) var(--pad);
          text-align: center;
        }
        .landing .cta h2 {
          font-size: clamp(48px, 8.4vw, 144px);
          letter-spacing: -0.055em;
          line-height: 0.9;
        }
        .landing .cta p {
          margin: 22px auto 0;
          color: var(--dgrey);
          max-width: 32ch;
          font-size: clamp(16px, 1.3vw, 19px);
        }
        .landing .cta .btn {
          background: #fff;
          color: #000;
          /* Inherits the 36px top margin the removed inline form carried. */
          margin-top: 36px;
        }
        .landing .cta .btn:hover {
          background: #e3e3e3;
        }
        .landing .cta .fine {
          margin-top: 14px;
          font-size: 13px;
          color: var(--dgrey);
        }

        .landing footer {
          padding: clamp(60px, 8vh, 110px) var(--pad) 0;
          overflow: hidden;
          border-top: 1px solid var(--line);
        }
        .landing .fcols {
          display: grid;
          grid-template-columns: 1.6fr 1fr 1fr 1fr;
          gap: 32px;
        }
        .landing .fcols h4 {
          font-size: 14px;
          font-weight: 700;
          margin-bottom: 14px;
        }
        .landing .fcols a {
          display: block;
          color: var(--grey);
          font-size: 14px;
          margin-bottom: 10px;
          transition: color 0.25s var(--ease);
        }
        .landing .fcols a:hover {
          color: #000;
        }
        .landing .fcols p {
          color: var(--grey);
          font-size: 14px;
          max-width: 26ch;
        }
        .landing .legal {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          font-size: 13px;
          color: var(--grey);
          margin-top: clamp(40px, 6vh, 72px);
        }
        .landing .fmark {
          font-size: clamp(120px, 33vw, 600px);
          font-weight: 700;
          letter-spacing: -0.07em;
          line-height: 0.74;
          white-space: nowrap;
          margin-top: 24px;
          transform: translateY(24%);
        }

        @media (max-width: 1000px) {
          .landing .badges {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (max-width: 820px) {
          .landing .links {
            display: none;
          }
          .landing .hero {
            padding-top: clamp(100px, 16vh, 140px);
          }
          .landing .phone {
            /* Mobile branch unchanged in effect: the source's 60vh height with
               a -26vh offset, re-expressed in the same two knobs (26/60). */
            --phone-h: 60vh;
            --phone-crop: 0.4333;
          }
          .landing .steps {
            grid-template-columns: 1fr;
            gap: 28px;
          }
          .landing .steps .title {
            position: static;
          }
          .landing .chev {
            width: 48vw;
          }
          .landing .dark {
            padding-top: 96px;
          }
          .landing .row {
            grid-template-columns: 1fr auto;
            grid-template-areas: 'word arrow' 'text text';
            gap: 16px 24px;
          }
          .landing .row-word {
            grid-area: word;
          }
          .landing .row-arrow {
            grid-area: arrow;
          }
          .landing .row p {
            grid-area: text;
          }
          .landing .note {
            grid-template-columns: 1fr;
            gap: 20px;
          }
          .landing .feats {
            grid-template-columns: 1fr;
          }
          .landing .feat.lead .shot {
            flex-direction: column;
            align-items: flex-start;
            min-height: 440px;
          }
          .landing .shot .log {
            flex: none;
            width: 100%;
            min-width: 0;
          }
          .landing .grid3 {
            grid-template-columns: 1fr;
          }
          .landing .fcols {
            grid-template-columns: 1fr 1fr;
          }
          .landing .fcols div:first-child {
            grid-column: 1 / -1;
          }
        }
        @media (max-width: 520px) {
          .landing .badges {
            grid-template-columns: 1fr;
          }
          .landing .feat .shot {
            aspect-ratio: 16 / 11;
          }
          .landing .feat.lead .shot {
            aspect-ratio: auto;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .landing .track,
          .landing .typing i {
            animation: none;
          }
          /* The source's html{scroll-behavior:auto} counterpart lives in the
             effect above, which simply never sets smooth under this query. */
          .landing * {
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
}
