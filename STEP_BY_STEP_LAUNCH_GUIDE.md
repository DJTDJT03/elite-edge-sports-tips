# Elite Edge Sports Tips — Step-by-Step Launch Guide

Everything you need to do, in order, with exact links and instructions.

---

## PHASE 1: BUSINESS SETUP (Day 1-2)

### Step 1: Register the Company
- Go to: https://www.gov.uk/set-up-limited-company
- Register "Elite Edge Sports Tips Ltd" — costs £12
- You'll need: your name, address, SIC code (use 63990 — Other information service activities)
- Takes 24-48 hours to process
- You'll get a company number and certificate of incorporation

### Step 2: Create the Business Gmail Account
- Go to: https://accounts.google.com/signup
- Create: `eliteedgesportstips@gmail.com`
- Use a strong password, enable 2FA
- This one account connects to EVERYTHING below

### Step 3: Open a Business Bank Account
- **Starling Bank** (fastest): https://www.starlingbank.com/business/
- Or **Tide**: https://www.tide.co/
- Download the app, verify ID, done in 24 hours
- You'll need this for Stripe payments

### Step 4: Register with ICO (Data Protection)
- Go to: https://ico.org.uk/for-organisations/register/
- Cost: £40/year
- Required because you process personal data (emails, names)
- Takes 5 minutes to complete online

---

## PHASE 2: DOMAIN & HOSTING (Day 2-3)

### Step 5: Buy the Domain
- Go to: https://www.namecheap.com
- Search for: `eliteedgesports.co.uk`
- Buy it (approximately £10/year)
- If taken, try: `eliteedgetips.com` or `eliteedgesportstips.com`

### Step 6: Deploy the App
**Option A — Railway (Recommended, easiest)**
1. Go to: https://railway.app
2. Click "Login with GitHub"
3. Log in with your GitHub account (DJTDJT03)
4. Click "New Project" → "Deploy from GitHub repo"
5. Select `DJTDJT03/elite-edge-sports-tips`
6. Railway auto-detects Node.js
7. It will run `npm install` and `npm start` automatically
8. Go to Settings → add custom domain: `eliteedgesports.co.uk`
9. Add environment variables:
   - `JWT_SECRET` = (make up a long random string, e.g. `EE-s3cret-k3y-2026-pr0duct10n`)
   - `GEO_RESTRICT` = `true`
   - `NODE_ENV` = `production`
10. Railway gives you a free SSL certificate automatically
11. Cost: Free tier (500 hours/mo) or $5/mo for always-on

**Option B — Render**
1. Go to: https://render.com
2. Sign up with GitHub
3. New → Web Service → connect `elite-edge-sports-tips`
4. Runtime: Node, Build: `npm install`, Start: `node server/index.js`
5. Add custom domain + environment variables (same as above)
6. Free tier available, $7/mo for always-on

### Step 7: Connect Domain to Hosting
1. In Namecheap: go to Domain → DNS settings
2. Railway/Render will give you a CNAME record to add
3. Add it in Namecheap DNS settings
4. Wait 15-30 minutes for DNS to propagate
5. Visit https://eliteedgesports.co.uk — should show your app with SSL

---

## PHASE 3: PAYMENT SYSTEM (Day 3-4)

### Step 8: Set Up Stripe
1. Go to: https://stripe.com
2. Sign up with your business Gmail
3. Complete business verification:
   - Company name: Elite Edge Sports Tips Ltd
   - Company number (from step 1)
   - Business bank account details (from step 3)
   - Your ID verification
4. In Stripe Dashboard:
   - Products → Create Product → "Premium Monthly" → £14.99/month recurring
   - Products → Create Product → "Premium Annual" → £119.99/year recurring
5. Get your API keys:
   - Publishable key: `pk_live_xxxx`
   - Secret key: `sk_live_xxxx`
6. Add to Railway/Render environment variables:
   - `STRIPE_PUBLIC_KEY` = your publishable key
   - `STRIPE_SECRET_KEY` = your secret key
7. Wire into the code (replace the placeholder modal with Stripe Checkout)

### Step 9: Test Payments
1. Use Stripe test mode first (toggle in Stripe dashboard)
2. Test card: 4242 4242 4242 4242, any future date, any CVC
3. Verify the subscription creates correctly
4. Switch to live mode when ready

---

## PHASE 4: EMAIL SYSTEM (Day 3-4)

### Step 10: Set Up SendGrid
1. Go to: https://sendgrid.com
2. Sign up with your business Gmail
3. Free tier: 100 emails/day (enough to start)
4. Go to Settings → Sender Authentication → verify your domain
   - Add DNS records they provide to Namecheap
   - This lets you send from `tips@eliteedgesports.co.uk`
5. Go to Settings → API Keys → Create API Key
6. Add to environment variables: `SENDGRID_API_KEY` = `SG.xxxxx`
7. The email service in the code is already architected for SendGrid

### Step 11: Create Email Templates
In SendGrid:
1. Marketing → Email Templates → Create template
2. Design your daily tip bulletin template:
   - Header: Elite Edge logo
   - Body: Today's selections with analysis
   - Footer: Disclaimer, unsubscribe link, BeGambleAware
3. Save the template ID for use in the admin panel

---

## PHASE 5: SOCIAL MEDIA ACCOUNTS (Day 2-3)

### Step 12: Create All Social Accounts

**Twitter/X:**
1. Go to: https://twitter.com/signup
2. Create: @EliteEdgeTips
3. Use business Gmail
4. Bio: "Data-driven UK racing & football intelligence | 86% racing SR | Free daily NAP | Premium from £14.99/mo | 18+ BeGambleAware"
5. Profile pic: EE logo (use the SVG converted to PNG)
6. Header: Create a banner in Canva (see Step 14)

**Instagram:**
1. Go to: https://www.instagram.com
2. Create: @eliteedgetips
3. Switch to Professional Account → Business
4. Bio: "🏇 86% Racing Strike Rate | ⚽ European Football Intel | 📊 Data, Not Guesswork | Free tips daily 👇"
5. Link: eliteedgesports.co.uk

**TikTok:**
1. Go to: https://www.tiktok.com/signup
2. Create: @eliteedgetips
3. Switch to Business Account
4. Bio: "Data-driven racing & football tips | 86% SR | Free daily"

**Telegram:**
1. Download Telegram app or use: https://web.telegram.org
2. Create a Channel (not a group): "Elite Edge Sports Tips"
3. Username: @EliteEdgeTips
4. Description: "Free daily NAP + premium tip alerts. 86% racing strike rate. Data-driven analysis."
5. Set channel to Public

**Facebook:**
1. Go to: https://www.facebook.com/pages/create
2. Create Page: "Elite Edge Sports Tips"
3. Category: Sports & Recreation
4. Also create a Group: "Elite Edge Community"

**YouTube:**
1. Go to: https://studio.youtube.com
2. Create channel (use business Gmail — already signed in)
3. Channel name: "Elite Edge Sports Tips"
4. Upload channel art and profile pic

**LinkedIn:**
1. Go to: https://www.linkedin.com/company/setup/new/
2. Create: "Elite Edge Sports Tips Ltd"
3. This is for B2B credibility and affiliate partner conversations

### Step 13: Connect All Socials to Buffer
1. Go to: https://buffer.com
2. Sign up with business Gmail
3. Free plan: 3 channels. Essentials: £5/mo per channel
4. Connect: Twitter, Instagram, Facebook, LinkedIn
5. Now you can schedule all posts from one dashboard
6. Telegram and TikTok: post manually (Buffer doesn't support them)

### Step 14: Create Brand Assets in Canva
1. Go to: https://www.canva.com
2. Sign up (free, or Pro at £10/mo for brand kit)
3. Create:
   - **Logo PNG** (export the SVG at 500x500)
   - **Twitter header** (1500x500): Dark background, EE logo, tagline, "86% Racing Strike Rate"
   - **Instagram post template** (1080x1080): Tip card design
   - **Results card template** (1080x1080): Daily results layout
   - **Weekly stats template** (1080x1080): Performance graphic
   - **Story template** (1080x1920): Quick tip story format
4. Save all templates for daily reuse
5. Use colours: Background #0a0e1a, Gold #d4a843, Green #22c55e, Red #ef4444

---

## PHASE 6: ANALYTICS & TRACKING (Day 4-5)

### Step 15: Set Up Google Analytics 4
1. Go to: https://analytics.google.com
2. Sign in with business Gmail
3. Create Account → "Elite Edge Sports Tips"
4. Create Property → web → `eliteedgesports.co.uk`
5. Get Measurement ID: `G-XXXXXXXXXX`
6. In your code, uncomment the GA4 script in index.html and add the ID
7. Push the code update to GitHub → Railway auto-deploys

### Step 16: Set Up Google Search Console
1. Go to: https://search.google.com/search-console
2. Add property → `eliteedgesports.co.uk`
3. Verify via DNS (add TXT record in Namecheap)
4. Submit sitemap: `https://eliteedgesports.co.uk/sitemap.xml`
5. This tells Google to index your site

### Step 17: Set Up Meta Pixel (Facebook/Instagram Ads)
1. Go to: https://business.facebook.com
2. Create Business Account
3. Events Manager → Create Pixel
4. Add pixel code to index.html (in the <head>)
5. This tracks conversions from Facebook/Instagram ads

---

## PHASE 7: DATA APIS (Day 5-7)

### Step 18: Connect Football Data
1. Go to: https://www.api-football.com
2. Sign up, choose plan ($19/mo starter)
3. Get API key
4. Add to environment: `API_FOOTBALL_KEY` = your key
5. Update `server/services/dataIngestion.js` with the key

### Step 19: Connect Racing Data
1. Go to: https://www.theracingapi.com
2. Sign up for free trial (2 weeks)
3. Get API key
4. Add to environment: `RACING_API_KEY` = your key

### Step 20: Connect Odds Data
1. Go to: https://the-odds-api.com
2. Sign up (free tier: 500 credits/month)
3. Get API key
4. Add to environment: `ODDS_API_KEY` = your key

---

## PHASE 8: AFFILIATE SETUP (Day 5-10)

### Step 21: Apply to Bookmaker Affiliates
Apply to all of these — it's free:

1. **Bet365 Affiliates**
   - Go to: https://www.bet365affiliates.com
   - Fill in application with your website URL
   - Commission: 30% revenue share
   - Wait 2-5 days for approval

2. **Sky Bet Affiliates**
   - Go to: https://affiliates.skybet.com
   - Apply with website details
   - Commission: 25-35% rev share or £30-50 CPA

3. **Betway Affiliates**
   - Go to: https://www.betwaypartners.com
   - Apply online
   - Commission: 25-40% tiered rev share

4. **BetVictor Affiliates**
   - Go to: https://www.betvictor.com/affiliates
   - Apply online
   - Commission: 30%+ negotiable

5. **William Hill Affiliates**
   - Go to: https://www.williamhillaffiliates.com
   - Apply online
   - Commission: 25-35% rev share

6. **Paddy Power Affiliates**
   - Go to: https://partnerships.paddypower.com
   - Apply online
   - Commission: 25-30% rev share

### Step 22: Add Affiliate Links to the App
1. When approved, you'll get unique tracking links from each bookmaker
2. Replace the placeholder URLs in the odds comparison widget
3. Each bookmaker gives you a dashboard to track clicks, signups, and commissions
4. Push code update to GitHub → auto-deploys

---

## PHASE 9: LAUNCH (Day 7-10)

### Step 23: Pre-Launch Checklist

Before you announce publicly, verify ALL of these:

- [ ] Website loads at https://eliteedgesports.co.uk
- [ ] SSL certificate shows (green padlock)
- [ ] Registration works (test with a new email)
- [ ] Login works
- [ ] Free user can see free tips
- [ ] Premium content is locked for free users
- [ ] Admin panel works (add a tip, mark a result)
- [ ] Cookie consent banner shows on first visit
- [ ] Disclaimer bar visible on every page
- [ ] Terms, Privacy, Disclaimer, Responsible Gambling pages load
- [ ] Legal agreement checkbox required on registration
- [ ] Stripe test payment works
- [ ] Email sends work (test via admin panel)
- [ ] All social accounts created and branded
- [ ] Buffer connected and first posts scheduled
- [ ] Google Analytics tracking (check real-time in GA4)
- [ ] Search Console verified and sitemap submitted
- [ ] Telegram channel created
- [ ] First 3 blog posts published on the site
- [ ] Mobile responsive (test on your phone)
- [ ] All pricing shows £14.99/mo correctly

### Step 24: Launch Day Execution

**6:00am:** Final checks — website up, all systems go
**6:30am:** Schedule all Day 1 posts in Buffer
**7:00am:** Publish launch announcement on all platforms simultaneously
**7:30am:** Post to Telegram channel
**8:00am:** Send launch email to any pre-registered users
**9:00am:** Publish first NAP of the Day across all platforms
**9:30am:** Share blog post link on all platforms
**Throughout day:** Monitor, respond to comments, engage
**Evening:** Post results (win or lose — transparency from day 1)
**9pm:** "Day 1 complete" post with stats
**10pm:** Schedule Day 2 content in Buffer

---

## PHASE 10: DAILY OPERATIONS (Ongoing)

### Daily Routine (30-45 minutes)

**Morning (before 9am):**
1. Open admin panel at eliteedgesports.co.uk/#/admin
2. Review today's fixtures (API data or manual research)
3. Add 1 free NAP + 1-3 premium selections via admin panel
4. Trigger email bulletin to premium subscribers
5. Post NAP to Telegram, Twitter, Instagram stories

**Afternoon/Evening:**
6. Monitor events as they finish
7. Mark results as won/lost in admin panel
8. Post results to all platforms
9. Update the weekly acca if needed (Friday)

**Weekly (Sunday evening, 30 mins):**
10. Review weekly stats
11. Create weekly results graphic in Canva
12. Post weekly roundup on all platforms
13. Schedule next week's content themes in Buffer
14. Update free acca for next weekend

---

## ALL PLATFORMS SUMMARY

| Platform | URL | What It's For | Cost |
|----------|-----|---------------|------|
| **Namecheap** | namecheap.com | Domain registration | £10/yr |
| **Railway** | railway.app | App hosting | Free-$5/mo |
| **Stripe** | stripe.com | Payment processing | 1.4% + 20p/tx |
| **SendGrid** | sendgrid.com | Email bulletins | Free (100/day) |
| **Google Analytics** | analytics.google.com | Website tracking | Free |
| **Search Console** | search.google.com/search-console | SEO monitoring | Free |
| **Buffer** | buffer.com | Social media scheduling | £5/mo per channel |
| **Canva** | canva.com | Graphics/templates | Free-£10/mo |
| **Twitter/X** | twitter.com | Tips, engagement | Free |
| **Instagram** | instagram.com | Visual content | Free |
| **TikTok** | tiktok.com | Short-form video | Free |
| **Telegram** | telegram.org | Instant tip delivery | Free |
| **Facebook** | facebook.com | Community + ads | Free + ad budget |
| **YouTube** | youtube.com | Video analysis | Free |
| **LinkedIn** | linkedin.com | B2B credibility | Free |
| **API-Football** | api-football.com | Football data | $19/mo |
| **The Racing API** | theracingapi.com | Racing data | ~£30/mo |
| **The Odds API** | the-odds-api.com | Odds comparison | Free-$30/mo |
| **Bet365 Affiliates** | bet365affiliates.com | Affiliate income | Free (earns you money) |
| **ICO** | ico.org.uk | Data protection reg | £40/yr |
| **Companies House** | gov.uk | Ltd company | £12 one-off |
| **Starling/Tide** | starlingbank.com | Business bank | Free |

### Total Monthly Running Costs (Starting)

| Item | Cost |
|------|------|
| Railway hosting | £5 |
| Domain | £1 (£10/yr) |
| Buffer (3 channels) | £15 |
| Canva Pro | £10 |
| API-Football | £16 ($19) |
| Racing API | £30 |
| ICO registration | £3 (£40/yr) |
| **Total** | **~£80/month** |

### Break-Even Point
£80/mo costs ÷ £14.99/mo subscription = **6 premium subscribers** to break even.

Subscriber #7 onwards is pure profit (before ad spend).
