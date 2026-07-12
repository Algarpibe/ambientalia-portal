# Quick Start Guide - SaaS Auth Page

Get up and running with the authentication page in 5 minutes.

## 🚀 Installation

No installation needed! All dependencies are already in the project.

## 📍 Access the Auth Page

1. **Start the development server**:
```bash
cd apps/portal
npm run dev
```

2. **Open in browser**:
```
http://localhost:5173/auth
```

That's it! You should see the premium SaaS authentication page.

---

## 🎨 Instant Customization

### Change Brand Color (Turquoise → Purple)

Edit `src/components/Auth/designTokens.ts`:

```ts
// Before
primary: '#1abc9c',      // Turquoise
primaryDark: '#16a085',
accent: '#48dbfb',

// After
primary: '#8b5cf6',      // Purple
primaryDark: '#7c3aed',
accent: '#a78bfa',
```

### Change Carousel Text

Edit `src/components/Auth/AuthLeftPanel.tsx`:

```tsx
const slides = [
  {
    headline: 'Your Headline Here',
    description: 'Your Description Here'
  },
  // ... more slides
];
```

### Change Form Labels

Edit `src/components/Auth/AuthRightPanel.tsx`:

```tsx
<label className="...">Your Custom Label</label>
<input placeholder="Your Custom Placeholder" />
<button>Your Button Text</button>
```

---

## ✅ Key Routes

| Path | Purpose |
|------|---------|
| `/auth` | Authentication page (no sidebar) |
| `/` | Dashboard (with sidebar) |

---

## 📚 Documentation

- [README.md](./README.md) - Full feature documentation
- [CUSTOMIZATION.md](./CUSTOMIZATION.md) - Detailed customization guide
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) - Complete implementation details
- [designTokens.ts](./designTokens.ts) - Color & animation constants

---

## 🔗 Connect to Your Backend

Edit `src/components/Auth/AuthRightPanel.tsx`, find `handleSubmit` function:

```tsx
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setIsLoading(true);
  
  try {
    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: formData.fullName,
        email: formData.email,
        password: formData.password
      })
    });

    const data = await response.json();
    
    if (response.ok) {
      // Success - redirect to dashboard
      window.location.href = '/';
    } else {
      // Show error
      alert(data.message || 'Authentication failed');
    }
  } catch (error) {
    console.error('Error:', error);
    alert('Something went wrong. Please try again.');
  } finally {
    setIsLoading(false);
  }
};
```

---

## 🎨 Pre-built Color Schemes

### Turquoise (Current)
```
Primary: #1abc9c | Dark: #16a085 | Accent: #48dbfb
```

### Purple
```
Primary: #8b5cf6 | Dark: #7c3aed | Accent: #a78bfa
```

### Blue
```
Primary: #2563eb | Dark: #1e40af | Accent: #3b82f6
```

### Green
```
Primary: #10b981 | Dark: #059669 | Accent: #6ee7b7
```

---

## 🔄 Form States

The form handles:
- ✅ Sign Up (default)
- ✅ Sign In
- ✅ Loading state with spinner
- ✅ Disabled state (terms not agreed)
- ✅ Password visibility toggle

---

## 📱 Mobile Responsive

The page automatically adjusts for:
- 📱 Mobile (320-640px) - Single column
- 📊 Tablet (641-1024px) - Single to split layout
- 🖥️ Desktop (1025px+) - Full split layout (50/50)

Test by:
1. Open DevTools (F12)
2. Toggle Device Toolbar (Ctrl+Shift+M)
3. Try different screen sizes

---

## ✨ Included Animations

- Fade-in page load
- Floating rocket
- Rotating carousel (auto 6s)
- Floating particles
- Twinkling stars
- Button hover elevation
- Input focus glow
- Smooth transitions

---

## 🎯 File Structure

```
src/
├── pages/
│   └── Auth.tsx                    # Main page
└── components/
    └── Auth/
        ├── index.ts                # Exports
        ├── AuthCard.tsx            # Split layout
        ├── AuthLeftPanel.tsx       # Rocket + carousel
        ├── AuthRightPanel.tsx      # Forms
        ├── RocketIllustration.tsx  # SVG rocket
        ├── designTokens.ts         # Constants
        ├── README.md               # Documentation
        ├── CUSTOMIZATION.md        # How to customize
        └── IMPLEMENTATION.md       # Complete details
```

---

## 🔍 Testing Checklist

- [ ] Visit `/auth` and see the page
- [ ] Click Sign In / Sign Up tabs
- [ ] Type in form fields
- [ ] Toggle password visibility
- [ ] Click and drag carousel indicators
- [ ] Hover over button (elevation effect)
- [ ] Test on mobile (DevTools)
- [ ] Check all text is readable
- [ ] Verify animations are smooth

---

## ⚡ Common Tasks

### Add OAuth Button
```tsx
<button className="w-full py-3 rounded-lg border border-white border-opacity-20 text-white hover:bg-white hover:bg-opacity-5">
  Continue with Google
</button>
```

### Add Error Message
```tsx
const [error, setError] = useState('');

// In form
{error && (
  <div className="p-3 rounded-lg bg-red-500 bg-opacity-10 border border-red-500 text-red-300 text-sm mb-6">
    {error}
  </div>
)}
```

### Add Success Message
```tsx
const [success, setSuccess] = useState(false);

// In form
{success && (
  <div className="p-3 rounded-lg bg-green-500 bg-opacity-10 border border-green-500 text-green-300 text-sm mb-6">
    ✓ Account created successfully! Redirecting...
  </div>
)}
```

### Change Animations Speed
Edit `designTokens.ts`:
```ts
carouselDuration: 4,        // Faster carousel
rocketFloat: 2,             // Faster rocket
fadeInDuration: 0.4,        // Quicker page load
```

---

## 🐛 Troubleshooting

### Page not loading?
- Clear browser cache (Ctrl+Shift+Delete)
- Restart dev server (`npm run dev`)
- Check console (F12) for errors

### Colors wrong?
- Verify Tailwind CSS is running
- Check file path to designTokens.ts
- Ensure CSS is imported

### Animations not smooth?
- Check browser performance (DevTools → Performance)
- Reduce particle count if needed
- Disable extensions that modify CSS

### Form not submitting?
- Check console (F12) for JavaScript errors
- Verify backend endpoint is correct
- Check network tab (F12 → Network)

---

## 📊 Browser Support

- ✅ Chrome/Edge (latest)
- ✅ Firefox (latest)
- ✅ Safari (latest)
- ✅ Mobile Safari (iOS 13+)
- ✅ Chrome Mobile

---

## 🎓 Learn More

- [React Router Docs](https://reactrouter.com/)
- [Tailwind CSS Docs](https://tailwindcss.com/)
- [Lucide Icons Docs](https://lucide.dev/)
- [React Forms Best Practices](https://react.dev/learn/understanding-the-ui-logic)

---

## 💡 Next Steps

1. ✅ View the auth page at `/auth`
2. ✅ Customize colors in designTokens.ts
3. ✅ Update form text
4. ✅ Connect to your backend API
5. ✅ Test on mobile
6. ✅ Deploy!

---

**Questions?** Check the detailed documentation files:
- [README.md](./README.md) for features
- [CUSTOMIZATION.md](./CUSTOMIZATION.md) for how to modify
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) for technical details

Happy customizing! 🚀
