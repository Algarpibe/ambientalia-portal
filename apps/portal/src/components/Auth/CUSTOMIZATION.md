# SaaS Auth Page - Customization Guide

This guide helps you customize the authentication page to match your brand and requirements.

## Quick Customization

### 1. Change Primary Colors

Edit [designTokens.ts](./designTokens.ts):

```ts
export const authColors = {
  primary: '#YOUR_COLOR',        // Main brand color
  primaryDark: '#YOUR_DARK_COLOR', // Darker variant
  accent: '#YOUR_ACCENT_COLOR',   // Highlight color
  // ... rest of colors
};
```

**Example**: Change turquoise to purple:
```ts
primary: '#8b5cf6',      // Purple
primaryDark: '#7c3aed',  // Darker purple
accent: '#a78bfa',       // Light purple
```

### 2. Change Gradients

Edit specific gradient strings in [designTokens.ts](./designTokens.ts):

```ts
leftPanelGradient: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #a78bfa 100%)',
```

Or directly in component files:

**Left Panel** ([AuthLeftPanel.tsx](./AuthLeftPanel.tsx)):
```tsx
style={{
  background: 'linear-gradient(135deg, #YOUR_START 0%, #YOUR_MID 50%, #YOUR_END 100%)'
}}
```

**Right Panel** ([AuthRightPanel.tsx](./AuthRightPanel.tsx)):
```tsx
style={{
  background: 'linear-gradient(135deg, #YOUR_START 0%, #YOUR_END 100%)'
}}
```

**Page Background** ([Auth.tsx](../../pages/Auth.tsx)):
```tsx
style={{
  background: 'linear-gradient(135deg, #YOUR_COLOR_1 0%, #YOUR_COLOR_2 100%)',
}}
```

### 3. Customize Text Content

#### Carousel Headlines & Descriptions

In [AuthLeftPanel.tsx](./AuthLeftPanel.tsx), update the `slides` array:

```tsx
const slides = [
  {
    headline: 'Your custom headline here',
    description: 'Your custom description'
  },
  {
    headline: 'Another headline',
    description: 'Another description'
  },
  // Add more slides as needed
];
```

#### Form Labels & Placeholders

In [AuthRightPanel.tsx](./AuthRightPanel.tsx):

```tsx
// Change placeholder
placeholder="Your custom text"

// Change label
<label className="block text-sm font-medium text-gray-300 mb-2">
  Your custom label
</label>

// Change button text
'Your Button Text'
```

#### Terms Link Text

In [AuthRightPanel.tsx](./AuthRightPanel.tsx):

```tsx
<span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
  I agree to all statements in{' '}
  <a href="#" className="text-cyan-400 hover:text-cyan-300 transition-colors">
    YOUR_LINK_TEXT
  </a>
</span>
```

### 4. Adjust Animations

Edit timings in [designTokens.ts](./designTokens.ts):

```ts
export const authAnimations = {
  transitionFast: 0.2,   // Fast transitions
  transitionBase: 0.3,   // Normal transitions
  transitionSlow: 0.5,   // Slow transitions
  carouselDuration: 6,   // Carousel auto-rotate (seconds)
  rocketFloat: 3,        // Rocket floating animation
  particleFloat: 5,      // Particle animation duration
  fadeInDuration: 0.7,   // Page load fade-in
};
```

**Example**: Speed up carousel to 4 seconds:
```ts
carouselDuration: 4,
```

### 5. Adjust Spacing & Sizing

Edit in [designTokens.ts](./designTokens.ts):

```ts
export const authSpacing = {
  cardRadius: '18px',      // Card corner roundness
  inputRadius: '8px',      // Input field roundness
  buttonRadius: '8px',     // Button roundness
  iconSize: 20,            // Icon pixel size
  checkboxSize: 20,        // Checkbox size
};
```

### 6. Change Particle Effects

Adjust particle and star counts in [designTokens.ts](./designTokens.ts):

```ts
export const authParticles = {
  particleCount: 15,       // Number of floating particles
  starCount: 12,           // Number of stars
  particleMinSize: 20,     // Minimum particle size
  particleMaxSize: 60,     // Maximum particle size
  starSize: 8,             // Star size
};
```

Edit the render logic in [AuthLeftPanel.tsx](./AuthLeftPanel.tsx):

```tsx
{[...Array(15)].map((_, i) => (  // Change 15 to your particleCount
  <div key={i} /* ... */ />
))}
```

### 7. Customize Button Styling

In [AuthRightPanel.tsx](./AuthRightPanel.tsx), update the button:

```tsx
<button
  type="submit"
  style={{
    background: 'YOUR_GRADIENT',
    boxShadow: 'YOUR_SHADOW'
  }}
  className="w-full py-3 px-4 rounded-lg font-semibold text-white transition-all duration-300 hover:shadow-lg hover:scale-105"
>
  Your Button Text
</button>
```

### 8. Modify Input Field Styling

In [AuthRightPanel.tsx](./AuthRightPanel.tsx):

```tsx
<input
  className="w-full pl-12 pr-4 py-3 rounded-lg bg-white bg-opacity-5 border border-white border-opacity-10 text-white placeholder-gray-500 transition-all duration-300 focus:outline-none focus:bg-opacity-10 focus:border-opacity-30 focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-20"
/>
```

Customize classes:
- `py-3` - Vertical padding
- `px-4` - Horizontal padding
- `rounded-lg` - Border radius
- `border-opacity-10` - Border visibility
- `focus:ring-cyan-400` - Focus ring color

### 9. Change Form Validation

Add custom validation in [AuthRightPanel.tsx](./AuthRightPanel.tsx):

```tsx
const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  
  // Add your validation logic
  if (!isValidEmail(formData.email)) {
    // Show error
    return;
  }
  
  // Proceed with submission
};
```

### 10. Integrate with Backend

Replace the stub submission in [AuthRightPanel.tsx](./AuthRightPanel.tsx):

```tsx
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setIsLoading(true);
  
  try {
    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    
    const data = await response.json();
    
    if (response.ok) {
      // Handle success - redirect to dashboard
      window.location.href = '/';
    } else {
      // Handle error
      console.error(data.message);
    }
  } catch (error) {
    console.error('Submission failed:', error);
  } finally {
    setIsLoading(false);
  }
};
```

## Advanced Customization

### Change Rocket Illustration

Replace [RocketIllustration.tsx](./RocketIllustration.tsx) with your own SVG:

```tsx
export default function RocketIllustration() {
  return (
    <svg /* your SVG here */>
      {/* Your SVG elements */}
    </svg>
  );
}
```

### Add Custom Font

Add to your CSS file:

```css
@import url('https://fonts.googleapis.com/css2?family=YOUR_FONT:wght@400;600;700&display=swap');

body {
  font-family: 'Your Font', sans-serif;
}
```

### Implement OAuth

Add OAuth provider buttons:

```tsx
<button className="w-full py-3 rounded-lg border border-white border-opacity-20 text-white hover:bg-white hover:bg-opacity-5 transition-all">
  Continue with Google
</button>
```

Install OAuth library:
```bash
npm install @react-oauth/google
```

### Add Multi-step Form

Modify [AuthRightPanel.tsx](./AuthRightPanel.tsx) to add step state:

```tsx
const [step, setStep] = useState(1);

return (
  <>
    {step === 1 && <EmailStep />}
    {step === 2 && <PasswordStep />}
    {step === 3 && <VerificationStep />}
  </>
);
```

## Color Scheme Examples

### Technology (Current - Turquoise)
```
Primary: #1abc9c
Dark: #16a085
Accent: #48dbfb
```

### Corporate (Blue)
```
Primary: #2563eb
Dark: #1e40af
Accent: #3b82f6
```

### Creative (Purple)
```
Primary: #8b5cf6
Dark: #7c3aed
Accent: #a78bfa
```

### Energetic (Red)
```
Primary: #ef4444
Dark: #dc2626
Accent: #f87171
```

## Testing Custom Styles

After making changes:

1. **In Development**:
```bash
cd apps/portal
npm run dev
# Navigate to http://localhost:5173/auth
```

2. **Check Responsive Design**:
- Open DevTools (F12)
- Toggle device toolbar (Ctrl+Shift+M)
- Test at mobile (375px), tablet (768px), and desktop (1920px)

3. **Validate Colors**:
- Use WebAIM Contrast Checker
- Ensure WCAG AA compliance (minimum 4.5:1 for text)

4. **Test Animations**:
- Check prefers-reduced-motion settings
- Verify smooth performance on lower-end devices

## Common Issues & Solutions

### Issue: Colors not updating
**Solution**: Clear browser cache (Ctrl+Shift+Delete) and restart dev server

### Issue: Animations laggy
**Solution**: Reduce `particleCount` and `starCount` in designTokens.ts

### Issue: Text not readable on background
**Solution**: Increase background opacity or adjust text color to lighter shade

### Issue: Mobile layout broken
**Solution**: Check Tailwind breakpoints (md = 768px)

## File Dependencies

```
Auth.tsx
├── AuthCard.tsx
│   ├── AuthLeftPanel.tsx
│   │   └── RocketIllustration.tsx
│   └── AuthRightPanel.tsx
├── designTokens.ts (optional - for constants)
└── README.md (documentation)
```

## Performance Tips

1. **Reduce animations** for users with `prefers-reduced-motion`:
```tsx
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
```

2. **Lazy load heavy images** if added
3. **Minify SVG** in RocketIllustration.tsx
4. **Use CSS containment** for particle effects

---

**Last Updated**: 2026-01-26  
**Version**: 1.0
