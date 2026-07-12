/**
 * Auth Page Design Tokens
 * Centralized configuration for colors, animations, and spacing
 */

export const authColors = {
  // Primary Colors
  primary: '#1abc9c',      // Turquoise
  primaryDark: '#16a085',  // Darker turquoise
  accent: '#48dbfb',       // Cyan

  // Gradients
  leftPanelGradient: 'linear-gradient(135deg, #1abc9c 0%, #16a085 50%, #48dbfb 100%)',
  rightPanelGradient: 'linear-gradient(135deg, #2d3561 0%, #1a2847 100%)',
  pageBackgroundGradient: 'linear-gradient(135deg, #ff6b6b 0%, #ff8787 25%, #ffa5a5 50%, #ffb3b3 75%, #ffc5c5 100%)',
  buttonGradient: 'linear-gradient(135deg, #1abc9c 0%, #48dbfb 100%)',

  // Text Colors
  textPrimary: '#ffffff',
  textSecondary: '#9ca3af',
  textMuted: '#6b7280',
  textInput: '#ffffff',
  placeholderText: '#9ca3af',

  // Component Backgrounds
  inputBackground: 'rgba(255, 255, 255, 0.05)',
  inputBorder: 'rgba(255, 255, 255, 0.1)',
  inputBorderFocus: 'rgba(255, 255, 255, 0.3)',

  // Shadows
  shadowSoft: '0 4px 10px rgba(26, 188, 156, 0.2)',
  shadowMedium: '0 8px 20px rgba(26, 188, 156, 0.3)',
  shadowCard: '0 20px 60px rgba(0, 0, 0, 0.3), 0 0 40px rgba(255, 107, 107, 0.1)',
  shadowHover: '0 12px 30px rgba(26, 188, 156, 0.4)',
};

export const authAnimations = {
  // Durations (in seconds)
  transitionFast: 0.2,
  transitionBase: 0.3,
  transitionSlow: 0.5,
  carouselDuration: 6,
  rocketFloat: 3,
  particleFloat: 5,
  fadeInDuration: 0.7,

  // Easing functions
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  easeOut: 'cubic-bezier(0.0, 0, 0.2, 1)',
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
};

export const authSpacing = {
  cardRadius: '18px',
  inputRadius: '8px',
  buttonRadius: '8px',
  iconSize: 20,
  checkboxSize: 20,
};

export const authParticles = {
  particleCount: 15,
  starCount: 12,
  particleMinSize: 20,
  particleMaxSize: 60,
  starSize: 8,
};

export const authResponsive = {
  breakpointMd: 768,
  cardPaddingDesktop: 48, // 12 in Tailwind
  cardPaddingMobile: 32,  // 8 in Tailwind
  maxWidth: 1024,
};

/**
 * Utility function to get dynamic shadow based on hover state
 */
export const getShadow = (isHover: boolean): string => {
  return isHover ? authColors.shadowHover : authColors.shadowMedium;
};

/**
 * Utility function to get button opacity based on disabled state
 */
export const getButtonOpacity = (isDisabled: boolean): number => {
  return isDisabled ? 0.6 : 1;
};

/**
 * Utility function to get input focus styles
 */
export const getInputFocusStyles = () => ({
  outline: 'none',
  backgroundColor: 'rgba(255, 255, 255, 0.1)',
  borderColor: 'rgba(255, 255, 255, 0.3)',
  boxShadow: `0 0 0 2px rgba(72, 219, 251, 0.2)`,
});
