/* @ds-bundle: {"format":4,"namespace":"MaueDesignSystem_961db8","components":[{"name":"ButtonPillOutline","sourcePath":"components/actions/ButtonPillOutline.jsx"},{"name":"ButtonPrimary","sourcePath":"components/actions/ButtonPrimary.jsx"},{"name":"ButtonSecondary","sourcePath":"components/actions/ButtonSecondary.jsx"},{"name":"CapabilityCard","sourcePath":"components/content/CapabilityCard.jsx"},{"name":"DarkFeatureBand","sourcePath":"components/content/DarkFeatureBand.jsx"},{"name":"ProductCard","sourcePath":"components/content/ProductCard.jsx"},{"name":"BlogFilterChip","sourcePath":"components/editorial/BlogFilterChip.jsx"},{"name":"ResearchTable","sourcePath":"components/editorial/ResearchTable.jsx"},{"name":"ContactFormCard","sourcePath":"components/forms/ContactFormCard.jsx"},{"name":"AgentConsoleCard","sourcePath":"components/media/AgentConsoleCard.jsx"},{"name":"HeroPhotoCard","sourcePath":"components/media/HeroPhotoCard.jsx"},{"name":"HeroPhotoCardOverlayNote","sourcePath":"components/media/HeroPhotoCard.jsx"},{"name":"Icon","sourcePath":"components/media/Icon.jsx"},{"name":"AnnouncementBar","sourcePath":"components/site/AnnouncementBar.jsx"},{"name":"FooterNewsletter","sourcePath":"components/site/FooterNewsletter.jsx"},{"name":"TrustLogoStrip","sourcePath":"components/site/TrustLogoStrip.jsx"}],"sourceHashes":{"components/actions/ButtonPillOutline.jsx":"0039736aca27","components/actions/ButtonPrimary.jsx":"e3dd1c2bc575","components/actions/ButtonSecondary.jsx":"8f785f79225c","components/content/CapabilityCard.jsx":"34638d837c49","components/content/DarkFeatureBand.jsx":"76841f0d44b3","components/content/ProductCard.jsx":"e65d2285d7ae","components/editorial/BlogFilterChip.jsx":"aab96e15b8c1","components/editorial/ResearchTable.jsx":"a16e41c1146a","components/forms/ContactFormCard.jsx":"19a34d75456d","components/media/AgentConsoleCard.jsx":"e6836c32d71a","components/media/HeroPhotoCard.jsx":"6d3375a60e83","components/media/Icon.jsx":"0d6b803c6f2d","components/site/AnnouncementBar.jsx":"ea47870f5d9d","components/site/FooterNewsletter.jsx":"d2ad1578cf0a","components/site/TrustLogoStrip.jsx":"c576a2129db2","ui_kits/website/BlogScreen.jsx":"a4b7e7f1d7b9","ui_kits/website/ContactScreen.jsx":"bcc863f6e129","ui_kits/website/HomeScreen.jsx":"a6f4d2378eaa","ui_kits/website/PlatformScreen.jsx":"55d967ee2600","ui_kits/website/ResearchScreen.jsx":"b9ec41e13f09","ui_kits/website/SiteNav.jsx":"1132dab6975c"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.MaueDesignSystem_961db8 = window.MaueDesignSystem_961db8 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/actions/ButtonPillOutline.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * Outlined pill control — transparent fill, 1px dark border, 30px radius, 6px 12px padding.
 * Research filters, topic tags and lightweight taxonomy controls.
 */
function ButtonPillOutline({
  children,
  href,
  selected = false,
  onSurface = "light",
  disabled = false,
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = useState(false);
  const inverse = onSurface === "dark";
  const line = inverse ? "var(--on-dark-rule)" : "var(--ink-900)";
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-xs)",
    padding: "6px 12px",
    borderRadius: "var(--radius-xl)",
    border: "1px solid " + line,
    background: selected ? inverse ? "var(--canvas)" : "var(--ink-900)" : hover && !disabled ? inverse ? "var(--on-dark-surface)" : "var(--pale-lilac)" : "transparent",
    color: selected ? inverse ? "var(--ink-900)" : "var(--on-primary)" : inverse ? "var(--text-on-dark)" : "var(--ink-900)",
    font: "var(--type-button)",
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    transition: "var(--transition-color)",
    ...style
  };
  const handlers = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false)
  };
  if (href && !disabled) {
    return /*#__PURE__*/React.createElement("a", _extends({
      href: href,
      style: base
    }, handlers, rest), children);
  }
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    onClick: onClick,
    "aria-pressed": selected,
    style: base
  }, handlers, rest), children);
}
Object.assign(__ds_scope, { ButtonPillOutline });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/ButtonPillOutline.jsx", error: String((e && e.message) || e) }); }

// components/actions/ButtonPrimary.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * Maue primary CTA — near-black pill on light surfaces, white pill on dark bands.
 * 14px Inter medium, 12px 24px padding, 32px pill radius. One per view.
 */
function ButtonPrimary({
  children,
  href,
  onSurface = "light",
  size = "md",
  disabled = false,
  fullWidth = false,
  type = "button",
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);
  const inverse = onSurface === "dark";
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-sm)",
    width: fullWidth ? "100%" : "auto",
    padding: size === "sm" ? "8px 18px" : "12px 24px",
    borderRadius: "var(--radius-pill)",
    border: "1px solid transparent",
    font: "var(--type-button)",
    fontSize: size === "lg" ? "var(--size-body)" : "var(--size-button)",
    letterSpacing: "var(--track-none)",
    textDecoration: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "var(--transition-color)",
    background: inverse ? "var(--action-primary-bg-inverse)" : "var(--action-primary-bg)",
    color: inverse ? "var(--action-primary-fg-inverse)" : "var(--action-primary-fg)",
    opacity: disabled ? 0.4 : press ? 0.82 : 1,
    ...style
  };
  if (hover && !disabled && !inverse) base.background = "var(--action-primary-bg-hover)";
  if (hover && !disabled && inverse) base.opacity = 0.88;
  const handlers = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setPress(false);
    },
    onMouseDown: () => setPress(true),
    onMouseUp: () => setPress(false)
  };
  if (href && !disabled) {
    return /*#__PURE__*/React.createElement("a", _extends({
      href: href,
      style: base
    }, handlers, rest), children);
  }
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    style: base
  }, handlers, rest), children);
}
Object.assign(__ds_scope, { ButtonPrimary });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/ButtonPrimary.jsx", error: String((e && e.message) || e) }); }

// components/actions/ButtonSecondary.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * Maue secondary action — a text-only link action, underlined on hover, no fill.
 * 16px Inter, 8px 0 padding. "Explore the platform", "Open the sandbox".
 */
function ButtonSecondary({
  children,
  href,
  onSurface = "light",
  underline = "always",
  withArrow = false,
  disabled = false,
  type = "button",
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = useState(false);
  const inverse = onSurface === "dark";
  const showRule = underline === "always" || underline === "hover" && hover;
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-sm)",
    padding: "8px 0",
    borderRadius: "var(--radius-xs)",
    border: "none",
    background: "transparent",
    font: "var(--type-body)",
    color: inverse ? "var(--text-on-dark)" : "var(--text-body)",
    textDecoration: showRule ? "underline" : "none",
    textUnderlineOffset: "4px",
    textDecorationThickness: "1px",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : hover && !disabled ? 0.7 : 1,
    transition: "var(--transition-color)",
    ...style
  };
  const handlers = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false)
  };
  const inner = /*#__PURE__*/React.createElement(React.Fragment, null, children, withArrow ? /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      font: "var(--type-body)"
    }
  }, "\u2192") : null);
  if (href && !disabled) {
    return /*#__PURE__*/React.createElement("a", _extends({
      href: href,
      style: base
    }, handlers, rest), inner);
  }
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    style: base
  }, handlers, rest), inner);
}
Object.assign(__ds_scope, { ButtonSecondary });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/ButtonSecondary.jsx", error: String((e && e.message) || e) }); }

// components/content/CapabilityCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * Content block with a thin-line icon, 24px heading, body copy and a text link.
 * On light backgrounds the card is usually unframed with only a top rule — full boxing
 * is the exception, not the default.
 */
function CapabilityCard({
  eyebrow,
  icon,
  title,
  body,
  linkLabel,
  href = "#",
  variant = "rule",
  onSurface = "light",
  style,
  ...rest
}) {
  const [hover, setHover] = useState(false);
  const inverse = onSurface === "dark";
  const boxed = variant === "boxed";
  return /*#__PURE__*/React.createElement("article", _extends({
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-md)",
      paddingTop: variant === "rule" ? "var(--space-xl)" : 0,
      borderTop: variant === "rule" ? inverse ? "var(--rule-on-dark)" : "var(--rule-1)" : "none",
      border: boxed ? inverse ? "var(--rule-on-dark)" : "var(--rule-card)" : undefined,
      background: boxed ? inverse ? "var(--on-dark-surface)" : "var(--surface-card)" : "transparent",
      borderRadius: boxed ? "var(--radius-xs)" : 0,
      padding: boxed ? "var(--space-xl)" : undefined,
      color: inverse ? "var(--text-on-dark)" : "var(--text-body)",
      ...style
    }
  }, rest), icon ? /*#__PURE__*/React.createElement("div", {
    style: {
      color: inverse ? "var(--text-on-dark)" : "var(--ink-900)",
      marginBottom: "var(--space-sm)"
    }
  }, icon) : null, eyebrow ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono-label)",
      letterSpacing: "var(--track-mono-label)",
      textTransform: "uppercase",
      color: inverse ? "var(--on-dark-muted)" : "var(--slate)"
    }
  }, eyebrow) : null, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      font: "var(--type-feature-heading)",
      color: inverse ? "var(--text-on-dark)" : "var(--text-heading)"
    }
  }, title), body ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--type-body)",
      color: inverse ? "var(--on-dark-muted)" : "var(--text-muted)",
      textWrap: "pretty"
    }
  }, body) : null, linkLabel ? /*#__PURE__*/React.createElement("a", {
    href: href,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      marginTop: "var(--space-xs)",
      font: "var(--type-body)",
      color: inverse ? "var(--text-on-dark)" : "var(--text-body)",
      textDecoration: "underline",
      textUnderlineOffset: "4px",
      textDecorationThickness: "1px",
      opacity: hover ? 0.7 : 1,
      transition: "var(--transition-color)",
      width: "fit-content"
    }
  }, linkLabel) : null);
}
Object.assign(__ds_scope, { CapabilityCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/CapabilityCard.jsx", error: String((e && e.message) || e) }); }

// components/content/DarkFeatureBand.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Deep indigo or clay full-width section for product capabilities, security claims and
 * feature breakdowns. Text turns white; nested cards use translucent surfaces and pale
 * borders. 80px padding; optionally inset with the 22px signature radius.
 */
function DarkFeatureBand({
  tone = "indigo",
  eyebrow,
  title,
  body,
  actions,
  media,
  children,
  layout = "stack",
  inset = false,
  style,
  ...rest
}) {
  const bg = {
    indigo: "var(--surface-band-indigo)",
    clay: "var(--surface-band-clay)",
    ink: "var(--surface-inverse)"
  }[tone] || "var(--surface-band-indigo)";
  const split = layout === "split";
  return /*#__PURE__*/React.createElement("section", _extends({
    style: {
      background: bg,
      color: "var(--text-on-dark)",
      padding: "var(--space-section)",
      borderRadius: inset ? "var(--radius-lg)" : 0,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container-max)",
      margin: "0 auto",
      display: split ? "grid" : "flex",
      gridTemplateColumns: split ? "minmax(0,1fr) minmax(0,1fr)" : undefined,
      flexDirection: split ? undefined : "column",
      alignItems: split ? "center" : "stretch",
      gap: "var(--space-56)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-xl)",
      maxWidth: split ? "none" : 720
    }
  }, eyebrow ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono-label)",
      letterSpacing: "var(--track-mono-label)",
      textTransform: "uppercase",
      color: "var(--on-dark-muted)"
    }
  }, eyebrow) : null, title ? /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: "var(--type-section-heading)",
      letterSpacing: "var(--track-section-heading)",
      color: "var(--text-on-dark)",
      textWrap: "balance"
    }
  }, title) : null, body ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--type-body-lg)",
      color: "var(--on-dark-muted)",
      maxWidth: 620,
      textWrap: "pretty"
    }
  }, body) : null, actions ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "var(--space-xl)",
      marginTop: "var(--space-sm)"
    }
  }, actions) : null), media ? /*#__PURE__*/React.createElement("div", null, media) : null, children ? /*#__PURE__*/React.createElement("div", {
    style: split ? undefined : {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
      gap: "var(--space-40)"
    }
  }, children) : null));
}
Object.assign(__ds_scope, { DarkFeatureBand });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/DarkFeatureBand.jsx", error: String((e && e.message) || e) }); }

// components/content/ProductCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Warm chalk card used for product/model summaries. 8px radius, 32px padding, a small pill
 * button, a divider line and checkmark bullet rows. Typically 3-column on desktop.
 */
function ProductCard({
  eyebrow,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  features = [],
  tone = "chalk",
  featured = false,
  style,
  ...rest
}) {
  const dark = tone === "ink" || tone === "indigo" || tone === "clay";
  const bg = {
    chalk: "var(--warm-chalk)",
    sand: "var(--pale-sand)",
    lilac: "var(--pale-lilac)",
    canvas: "var(--canvas)",
    ink: "var(--ink-900)",
    indigo: "var(--deep-indigo)",
    clay: "var(--deep-clay)"
  }[tone] || "var(--warm-chalk)";
  const fg = dark ? "var(--text-on-dark)" : "var(--text-body)";
  const rule = dark ? "var(--rule-on-dark)" : "1px solid rgba(31,32,35,.14)";
  return /*#__PURE__*/React.createElement("article", _extends({
    style: {
      background: bg,
      color: fg,
      borderRadius: "var(--radius-sm)",
      padding: "var(--space-xxl)",
      border: tone === "canvas" ? "var(--rule-card)" : "none",
      outline: featured ? "1px solid " + (dark ? "rgba(255,255,255,.4)" : "var(--ink-900)") : "none",
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-lg)",
      ...style
    }
  }, rest), eyebrow ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono-label)",
      letterSpacing: "var(--track-mono-label)",
      textTransform: "uppercase",
      color: dark ? "var(--on-dark-muted)" : "var(--slate)"
    }
  }, eyebrow) : null, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      font: "var(--type-feature-heading)",
      color: dark ? "var(--text-on-dark)" : "var(--text-heading)"
    }
  }, title), description ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--type-body)",
      color: dark ? "var(--on-dark-muted)" : "var(--text-muted)",
      textWrap: "pretty"
    }
  }, description) : null, actionLabel ? /*#__PURE__*/React.createElement("a", {
    href: actionHref || "#",
    onClick: onAction,
    style: {
      width: "fit-content",
      padding: "8px 18px",
      borderRadius: "var(--radius-pill)",
      background: dark ? "var(--canvas)" : "var(--ink-900)",
      color: dark ? "var(--ink-900)" : "var(--on-primary)",
      font: "var(--type-button)",
      textDecoration: "none",
      transition: "var(--transition-color)"
    }
  }, actionLabel) : null, features.length ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("hr", {
    style: {
      border: "none",
      borderTop: rule,
      margin: "var(--space-xs) 0 0"
    }
  }), /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: "none",
      margin: 0,
      padding: 0,
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-md)"
    }
  }, features.map(f => /*#__PURE__*/React.createElement("li", {
    key: f,
    style: {
      display: "flex",
      gap: "var(--space-md)",
      font: "var(--type-body)",
      color: dark ? "var(--on-dark-muted)" : "var(--text-body)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      color: dark ? "var(--text-on-dark)" : "var(--ink-900)"
    }
  }, "\u2713"), /*#__PURE__*/React.createElement("span", {
    style: {
      textWrap: "pretty"
    }
  }, f))))) : null);
}
Object.assign(__ds_scope, { ProductCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/ProductCard.jsx", error: String((e && e.message) || e) }); }

// components/editorial/BlogFilterChip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * Large marigold taxonomy chip for the blog index. Active chips invert to marigold fill with
 * dark text; inactive chips use a marigold outline over a pale sand fill. Typography is
 * oversized (32px) relative to a normal filter — the taxonomy is a hero-level control.
 */
function BlogFilterChip({
  children,
  active = false,
  size = "lg",
  count,
  onClick,
  href,
  style,
  ...rest
}) {
  const [hover, setHover] = useState(false);
  const lg = size === "lg";
  const base = {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "var(--space-md)",
    padding: lg ? "8px 14px" : "6px 12px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid " + (active ? "var(--marigold)" : "var(--marigold-soft)"),
    background: active ? "var(--marigold)" : hover ? "var(--pale-sand)" : "transparent",
    color: active ? "var(--ink-900)" : "var(--marigold)",
    font: lg ? "var(--type-card-heading)" : "var(--type-feature-heading)",
    letterSpacing: lg ? "var(--track-card-heading)" : "var(--track-none)",
    textDecoration: "none",
    cursor: "pointer",
    transition: "var(--transition-color)",
    ...style
  };
  const handlers = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false)
  };
  const inner = /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", null, children), count != null ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: active ? "var(--ink-900)" : "var(--marigold)",
      opacity: 0.75
    }
  }, count) : null);
  if (href) return /*#__PURE__*/React.createElement("a", _extends({
    href: href,
    style: base
  }, handlers, rest), inner);
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-pressed": active,
    onClick: onClick,
    style: base
  }, handlers, rest), inner);
}
Object.assign(__ds_scope, { BlogFilterChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/editorial/BlogFilterChip.jsx", error: String((e && e.message) || e) }); }

// components/editorial/ResearchTable.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * Rule-separated publication list: title left, topic pills centered, date right. Rows are
 * tall, white and border-driven — no cards, no shadows.
 */
function ResearchTable({
  rows = [],
  columnLabels,
  onRowClick,
  style,
  ...rest
}) {
  const [hovered, setHovered] = useState(-1);
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      borderTop: "var(--rule-1)",
      ...style
    }
  }, rest), columnLabels ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "minmax(0,1fr) minmax(180px,auto) 120px",
      gap: "var(--space-xl)",
      padding: "var(--space-md) 0",
      borderBottom: "var(--rule-1)",
      font: "var(--type-mono-label)",
      letterSpacing: "var(--track-mono-label)",
      textTransform: "uppercase",
      color: "var(--slate)"
    }
  }, /*#__PURE__*/React.createElement("span", null, columnLabels[0]), /*#__PURE__*/React.createElement("span", null, columnLabels[1]), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: "right"
    }
  }, columnLabels[2])) : null, rows.map((row, i) => /*#__PURE__*/React.createElement("div", {
    key: row.title + i,
    onMouseEnter: () => setHovered(i),
    onMouseLeave: () => setHovered(-1),
    onClick: onRowClick ? () => onRowClick(row, i) : undefined,
    style: {
      display: "grid",
      gridTemplateColumns: "minmax(0,1fr) minmax(180px,auto) 120px",
      gap: "var(--space-xl)",
      alignItems: "center",
      padding: "var(--space-28) 0",
      borderBottom: "var(--rule-1)",
      background: hovered === i ? "var(--pale-lilac)" : "transparent",
      cursor: onRowClick ? "pointer" : "default",
      transition: "var(--transition-color)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-xs)",
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: row.href || "#",
    style: {
      font: "var(--type-body-lg)",
      color: "var(--text-body)",
      textDecoration: hovered === i ? "underline" : "none",
      textUnderlineOffset: "4px",
      textWrap: "pretty"
    }
  }, row.title), row.authors ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--slate)"
    }
  }, row.authors) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: "var(--space-sm)"
    }
  }, (row.topics || []).map(t => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      padding: "4px 12px",
      borderRadius: "var(--radius-xl)",
      border: "1px solid var(--hairline)",
      font: "var(--type-micro)",
      color: "var(--text-body)",
      whiteSpace: "nowrap"
    }
  }, t))), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-meta)",
      textAlign: "right"
    }
  }, row.date))));
}
Object.assign(__ds_scope, { ResearchTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/editorial/ResearchTable.jsx", error: String((e && e.message) || e) }); }

// components/forms/ContactFormCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * Rounded white form panel set against dark indigo or warm chalk sections. Inputs are
 * rectangular with thin gray borders and compact labels; submit uses the near-black pill.
 */
function ContactFormCard({
  title,
  description,
  fields = [],
  submitLabel = "Submit",
  footnote,
  onSubmit,
  sentMessage = "Thanks — we'll be in touch within one business day.",
  style,
  ...rest
}) {
  const [values, setValues] = useState({});
  const [focused, setFocused] = useState(null);
  const [sent, setSent] = useState(false);
  const set = (name, v) => setValues(p => ({
    ...p,
    [name]: v
  }));
  const inputStyle = name => ({
    width: "100%",
    padding: "var(--space-md) var(--space-lg)",
    borderRadius: "var(--radius-xs)",
    border: "1px solid " + (focused === name ? "var(--border-input-focus)" : "var(--border-input)"),
    background: "var(--canvas)",
    color: "var(--text-body)",
    font: "var(--type-body)",
    outline: "none",
    boxSizing: "border-box",
    transition: "var(--transition-color)"
  });
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: "var(--surface-card)",
      borderRadius: "var(--radius-lg)",
      padding: "var(--space-xxl)",
      color: "var(--text-body)",
      ...style
    }
  }, rest), title ? /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      font: "var(--type-feature-heading)",
      color: "var(--text-heading)"
    }
  }, title) : null, description ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "var(--space-md) 0 0",
      font: "var(--type-body)",
      color: "var(--text-muted)",
      textWrap: "pretty"
    }
  }, description) : null, sent ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "var(--space-xl) 0 0",
      font: "var(--type-body-lg)",
      color: "var(--text-body)"
    }
  }, sentMessage) : /*#__PURE__*/React.createElement("form", {
    onSubmit: e => {
      e.preventDefault();
      setSent(true);
      if (onSubmit) onSubmit(values);
    },
    style: {
      marginTop: "var(--space-xl)",
      display: "grid",
      gridTemplateColumns: "repeat(2,minmax(0,1fr))",
      gap: "var(--space-lg)"
    }
  }, fields.map(f => /*#__PURE__*/React.createElement("label", {
    key: f.name,
    style: {
      gridColumn: f.span === 2 || f.type === "textarea" ? "1 / -1" : "auto",
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-sm)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-muted)"
    }
  }, f.label, f.required ? " *" : ""), f.type === "textarea" ? /*#__PURE__*/React.createElement("textarea", {
    rows: f.rows || 4,
    required: f.required,
    placeholder: f.placeholder,
    value: values[f.name] || "",
    onChange: e => set(f.name, e.target.value),
    onFocus: () => setFocused(f.name),
    onBlur: () => setFocused(null),
    style: {
      ...inputStyle(f.name),
      resize: "vertical"
    }
  }) : f.type === "select" ? /*#__PURE__*/React.createElement("select", {
    required: f.required,
    value: values[f.name] || "",
    onChange: e => set(f.name, e.target.value),
    onFocus: () => setFocused(f.name),
    onBlur: () => setFocused(null),
    style: inputStyle(f.name)
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, f.placeholder || "Select"), (f.options || []).map(o => /*#__PURE__*/React.createElement("option", {
    key: o,
    value: o
  }, o))) : /*#__PURE__*/React.createElement("input", {
    type: f.type || "text",
    required: f.required,
    placeholder: f.placeholder,
    value: values[f.name] || "",
    onChange: e => set(f.name, e.target.value),
    onFocus: () => setFocused(f.name),
    onBlur: () => setFocused(null),
    style: inputStyle(f.name)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      gridColumn: "1 / -1",
      display: "flex",
      alignItems: "center",
      gap: "var(--space-xl)",
      flexWrap: "wrap",
      marginTop: "var(--space-sm)"
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "submit",
    style: {
      padding: "12px 24px",
      borderRadius: "var(--radius-pill)",
      border: "none",
      background: "var(--action-primary-bg)",
      color: "var(--action-primary-fg)",
      font: "var(--type-button)",
      cursor: "pointer",
      transition: "var(--transition-color)"
    }
  }, submitLabel), footnote ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-micro)",
      color: "var(--text-meta)"
    }
  }, footnote) : null)));
}
Object.assign(__ds_scope, { ContactFormCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/ContactFormCard.jsx", error: String((e && e.message) || e) }); }

// components/media/AgentConsoleCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Dark product-mockup panel: agent name, status chip, integration badges, prompt field and a
 * generated response card. Structurally honest by default — placeholder frames, not invented
 * dashboard data. Background is near-black, text white or muted, chips small.
 */
function AgentConsoleCard({
  agentName = "Agent",
  status = "Running",
  statusTone = "active",
  integrations = [],
  prompt,
  promptPlaceholder = "Describe the task",
  response,
  compact = false,
  style,
  ...rest
}) {
  const dot = {
    active: "var(--marigold)",
    idle: "var(--muted)",
    done: "var(--focus-blue)"
  }[statusTone] || "var(--marigold)";
  const pad = compact ? "var(--space-lg)" : "var(--space-xl)";
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: "var(--ink-900)",
      color: "var(--text-on-dark)",
      borderRadius: "var(--radius-sm)",
      padding: pad,
      border: "var(--rule-on-dark)",
      display: "flex",
      flexDirection: "column",
      gap: compact ? "var(--space-md)" : "var(--space-lg)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "var(--space-md)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono-label)",
      letterSpacing: "var(--track-mono-label)",
      textTransform: "uppercase"
    }
  }, agentName), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--space-xs)",
      padding: "2px 10px",
      borderRadius: "var(--radius-full)",
      border: "var(--rule-on-dark)",
      background: "var(--on-dark-surface)",
      font: "var(--type-micro)",
      color: "var(--on-dark-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: "var(--radius-full)",
      background: dot,
      display: "block"
    }
  }), status)), integrations.length ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: "var(--space-sm)"
    }
  }, integrations.map(it => /*#__PURE__*/React.createElement("span", {
    key: it,
    style: {
      padding: "4px 10px",
      borderRadius: "var(--radius-xs)",
      border: "var(--rule-on-dark)",
      font: "var(--type-micro)",
      color: "var(--on-dark-muted)"
    }
  }, it))) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "var(--space-md)",
      padding: "var(--space-md) var(--space-lg)",
      borderRadius: "var(--radius-xs)",
      border: "var(--rule-on-dark)",
      background: "var(--on-dark-surface)",
      font: "var(--type-body)",
      color: prompt ? "var(--text-on-dark)" : "var(--on-dark-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", null, prompt || promptPlaceholder), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      color: "var(--on-dark-muted)"
    }
  }, "\u2192")), response ? /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: "var(--radius-xs)",
      border: "var(--rule-on-dark)",
      padding: "var(--space-lg)",
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-sm)"
    }
  }, response.title ? /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--type-mono-label)",
      letterSpacing: "var(--track-mono-label)",
      textTransform: "uppercase",
      color: "var(--on-dark-muted)"
    }
  }, response.title) : null, (response.lines || []).map((l, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      font: "var(--type-caption)",
      color: i === 0 ? "var(--text-on-dark)" : "var(--on-dark-muted)"
    }
  }, l)), response.bars ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-sm)",
      marginTop: "var(--space-xs)"
    }
  }, [92, 64, 78].map((w, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      display: "block",
      height: 6,
      width: w + "%",
      borderRadius: "var(--radius-full)",
      background: "var(--on-dark-rule)"
    }
  }))) : null) : null);
}
Object.assign(__ds_scope, { AgentConsoleCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/media/AgentConsoleCard.jsx", error: String((e && e.message) || e) }); }

// components/media/HeroPhotoCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * Rounded media card used in the home hero and solution pages: photography or abstract
 * imagery at 22px radius (8px on small thumbnails), optionally with a dark agent-console
 * module overlaid. No image assets ship with the brand source, so an unset card renders an
 * honest placeholder field rather than invented product content.
 */
const TONES = {
  chalk: "var(--warm-chalk)",
  sand: "var(--pale-sand)",
  lilac: "var(--pale-lilac)",
  indigo: "var(--deep-indigo)",
  clay: "var(--deep-clay)",
  ink: "var(--ink-900)"
};
function HeroPhotoCard({
  src,
  alt = "",
  tone = "chalk",
  radius = "lg",
  ratio = "16 / 10",
  label,
  caption,
  overlay,
  overlayPosition = "bottom-left",
  children,
  style,
  ...rest
}) {
  const dark = tone === "indigo" || tone === "clay" || tone === "ink";
  const pos = {
    "bottom-left": {
      alignItems: "flex-end",
      justifyContent: "flex-start"
    },
    "bottom-right": {
      alignItems: "flex-end",
      justifyContent: "flex-end"
    },
    "top-left": {
      alignItems: "flex-start",
      justifyContent: "flex-start"
    },
    center: {
      alignItems: "center",
      justifyContent: "center"
    }
  }[overlayPosition] || {
    alignItems: "flex-end",
    justifyContent: "flex-start"
  };
  return /*#__PURE__*/React.createElement("figure", _extends({
    style: {
      margin: 0,
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-md)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      overflow: "hidden",
      borderRadius: radius === "sm" ? "var(--radius-sm)" : radius === "xs" ? "var(--radius-xs)" : radius === "md" ? "var(--radius-md)" : "var(--radius-lg)",
      background: TONES[tone] || TONES.chalk,
      aspectRatio: ratio,
      width: "100%",
      display: overlay ? "flex" : "block",
      minHeight: overlay ? "min-content" : undefined,
      padding: overlay ? "var(--space-xl)" : 0,
      ...(overlay ? pos : null)
    }
  }, src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: alt,
    style: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block"
    }
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      font: "var(--type-mono-label)",
      letterSpacing: "var(--track-mono-label)",
      textTransform: "uppercase",
      color: dark ? "var(--on-dark-muted)" : "var(--slate)"
    }
  }, label || "Image placeholder"), overlay ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      maxWidth: "min(420px, 78%)",
      width: "100%"
    }
  }, overlay) : null, children), caption ? /*#__PURE__*/React.createElement("figcaption", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-meta)"
    }
  }, caption) : null);
}

/** Small dark status module used as the default overlay content inside a hero card. */
function HeroPhotoCardOverlayNote({
  title,
  body
}) {
  const [hover, setHover] = useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      background: "var(--ink-900)",
      color: "var(--text-on-dark)",
      borderRadius: "var(--radius-sm)",
      padding: "var(--space-lg) var(--space-xl)",
      border: "var(--rule-on-dark)",
      opacity: hover ? 0.96 : 1,
      transition: "var(--transition-color)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--type-mono-label)",
      letterSpacing: "var(--track-mono-label)",
      textTransform: "uppercase",
      color: "var(--on-dark-muted)"
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--type-body)",
      marginTop: "var(--space-sm)"
    }
  }, body));
}
Object.assign(__ds_scope, { HeroPhotoCard, HeroPhotoCardOverlayNote });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/media/HeroPhotoCard.jsx", error: String((e && e.message) || e) }); }

// components/media/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useEffect,
  useState
} = React;
/**
 * Thin-line geometric icon. Maue has no proprietary icon binary; the brand source
 * specifies an openly licensed baseline (Lucide, ISC) drawn at a uniform 1.5px stroke.
 * Load Lucide once per page:
 *   <script src="https://unpkg.com/lucide@0.454.0/dist/umd/lucide.min.js"></script>
 */
const toPascal = n => String(n).replace(/(^|[-_ ])(\w)/g, (_, __, c) => c.toUpperCase());
const toCamel = k => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function useLucide() {
  const [lib, setLib] = useState(() => typeof window !== "undefined" ? window.lucide : null);
  useEffect(() => {
    if (lib || typeof window === "undefined") return;
    let tries = 0;
    const id = setInterval(() => {
      if (window.lucide) {
        setLib(window.lucide);
        clearInterval(id);
      } else if (++tries > 60) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [lib]);
  return lib;
}
function Icon({
  name,
  size = 24,
  strokeWidth = 1.5,
  color = "currentColor",
  label,
  style,
  ...rest
}) {
  const lib = useLucide();
  const node = lib && lib.icons ? lib.icons[toPascal(name)] || lib.icons[name] : null;
  const children = node ? node[0] === "svg" ? node[2] : node : [];
  return /*#__PURE__*/React.createElement("svg", _extends({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    role: label ? "img" : "presentation",
    "aria-label": label,
    "aria-hidden": label ? undefined : "true",
    style: {
      display: "block",
      flex: "none",
      ...style
    }
  }, rest), label ? /*#__PURE__*/React.createElement("title", null, label) : null, (children || []).map(([tag, attrs], i) => {
    const props = {};
    Object.keys(attrs || {}).forEach(k => {
      props[toCamel(k)] = attrs[k];
    });
    return React.createElement(tag, {
      key: i,
      ...props
    });
  }));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/media/Icon.jsx", error: String((e && e.message) || e) }); }

// components/site/AnnouncementBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * Full-width black strip above the nav: 36px tall, centered microcopy, an underlined
 * link and a close control at the far right.
 */
function AnnouncementBar({
  children,
  linkLabel,
  linkHref = "#",
  dismissible = true,
  onClose,
  style,
  ...rest
}) {
  const [closed, setClosed] = useState(false);
  const [hover, setHover] = useState(false);
  if (closed) return null;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      position: "relative",
      height: "var(--announcement-height)",
      background: "var(--surface-announcement)",
      color: "var(--text-on-dark)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "var(--space-sm)",
      padding: "0 var(--space-40)",
      font: "var(--type-micro)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", null, children), linkLabel ? /*#__PURE__*/React.createElement("a", {
    href: linkHref,
    style: {
      color: "var(--text-on-dark)",
      textDecoration: "underline",
      textUnderlineOffset: "2px",
      opacity: hover ? 0.7 : 1,
      transition: "var(--transition-color)"
    },
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false)
  }, linkLabel) : null, dismissible ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Dismiss announcement",
    onClick: () => {
      setClosed(true);
      if (onClose) onClose();
    },
    style: {
      position: "absolute",
      right: "var(--space-lg)",
      top: "50%",
      transform: "translateY(-50%)",
      background: "transparent",
      border: "none",
      color: "var(--on-dark-muted)",
      font: "var(--type-micro)",
      fontSize: "14px",
      lineHeight: 1,
      cursor: "pointer",
      padding: "var(--space-xs)"
    }
  }, "\xD7") : null);
}
Object.assign(__ds_scope, { AnnouncementBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/site/AnnouncementBar.jsx", error: String((e && e.message) || e) }); }

// components/site/FooterNewsletter.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * Dark footer subscription block: marigold eyebrow, white headline, muted legal microcopy,
 * a single-line email field and an arrow submit marker. Footer columns use white section
 * labels and muted links.
 */
function FooterNewsletter({
  eyebrow = "Newsletter",
  headline,
  microcopy,
  placeholder = "Work email",
  columns = [],
  legal,
  onSubmit,
  style,
  ...rest
}) {
  const [value, setValue] = useState("");
  const [focus, setFocus] = useState(false);
  const [sent, setSent] = useState(false);
  return /*#__PURE__*/React.createElement("footer", _extends({
    style: {
      background: "var(--surface-inverse)",
      color: "var(--text-on-dark)",
      padding: "var(--space-section) var(--gutter)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container-max)",
      margin: "0 auto",
      display: "flex",
      flexWrap: "wrap",
      gap: "var(--space-64)",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "1 1 360px",
      maxWidth: 480,
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-lg)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono-label)",
      letterSpacing: "var(--track-mono-label)",
      textTransform: "uppercase",
      color: "var(--marigold)"
    }
  }, eyebrow), headline ? /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: "var(--type-card-heading)",
      letterSpacing: "var(--track-card-heading)",
      color: "var(--text-on-dark)"
    }
  }, headline) : null, microcopy ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--type-micro)",
      color: "var(--on-dark-muted)"
    }
  }, microcopy) : null, sent ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--type-caption)",
      color: "var(--text-on-dark)",
      borderBottom: "var(--rule-on-dark)",
      paddingBottom: "var(--space-md)"
    }
  }, "Subscribed \u2014 look for the next dispatch.") : /*#__PURE__*/React.createElement("form", {
    onSubmit: e => {
      e.preventDefault();
      setSent(true);
      if (onSubmit) onSubmit(value);
    },
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-md)",
      borderBottom: "1px solid " + (focus ? "rgba(255,255,255,.5)" : "var(--on-dark-rule)"),
      paddingBottom: "var(--space-md)",
      transition: "var(--transition-color)"
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "email",
    required: true,
    value: value,
    onChange: e => setValue(e.target.value),
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    placeholder: placeholder,
    style: {
      flex: 1,
      background: "transparent",
      border: "none",
      outline: "none",
      color: "var(--text-on-dark)",
      font: "var(--type-body)"
    }
  }), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    "aria-label": "Subscribe",
    style: {
      background: "transparent",
      border: "none",
      color: "var(--text-on-dark)",
      font: "var(--type-body-lg)",
      cursor: "pointer",
      padding: 0
    }
  }, "\u2192"))), columns.length ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: "var(--space-64)"
    }
  }, columns.map(col => /*#__PURE__*/React.createElement("nav", {
    key: col.label,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-md)",
      minWidth: 140
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-micro)",
      color: "var(--text-on-dark)"
    }
  }, col.label), (col.links || []).map(l => /*#__PURE__*/React.createElement("a", {
    key: l.label,
    href: l.href || "#",
    style: {
      font: "var(--type-micro)",
      color: "var(--muted)",
      textDecoration: "none"
    }
  }, l.label))))) : null), legal ? /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container-max)",
      margin: "var(--space-56) auto 0",
      borderTop: "var(--rule-on-dark)",
      paddingTop: "var(--space-xl)",
      font: "var(--type-micro)",
      color: "var(--muted)"
    }
  }, legal) : null);
}
Object.assign(__ds_scope, { FooterNewsletter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/site/FooterNewsletter.jsx", error: String((e && e.message) || e) }); }

// components/site/TrustLogoStrip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Centered copy above a row of monochrome customer marks. Intentionally quiet: no cards,
 * no borders, wide horizontal spacing, black or white marks depending on the surface.
 * No customer logo files ship with the brand source, so names render as plain wordmarks.
 */
function TrustLogoStrip({
  caption,
  logos = [],
  onSurface = "light",
  align = "center",
  style,
  ...rest
}) {
  const inverse = onSurface === "dark";
  return /*#__PURE__*/React.createElement("section", _extends({
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: align === "center" ? "center" : "flex-start",
      gap: "var(--space-40)",
      background: inverse ? "transparent" : "var(--canvas)",
      ...style
    }
  }, rest), caption ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--type-caption)",
      color: inverse ? "var(--on-dark-muted)" : "var(--text-body)",
      textAlign: align
    }
  }, caption) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: align === "center" ? "center" : "flex-start",
      columnGap: "var(--space-64)",
      rowGap: "var(--space-xl)"
    }
  }, logos.map(l => typeof l === "string" ? /*#__PURE__*/React.createElement("span", {
    key: l,
    style: {
      font: "var(--type-feature-heading)",
      letterSpacing: "-0.2px",
      color: inverse ? "var(--text-on-dark)" : "var(--maue-black)",
      opacity: 0.86,
      whiteSpace: "nowrap"
    }
  }, l) : /*#__PURE__*/React.createElement("img", {
    key: l.src,
    src: l.src,
    alt: l.alt || "",
    style: {
      height: l.height || 24,
      width: "auto",
      display: "block",
      filter: inverse ? "brightness(0) invert(1)" : "brightness(0)"
    }
  }))));
}
Object.assign(__ds_scope, { TrustLogoStrip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/site/TrustLogoStrip.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/BlogScreen.jsx
try { (() => {
const {
  BlogFilterChip,
  HeroPhotoCard,
  ButtonPrimary,
  ButtonSecondary
} = window.MaueDesignSystem_961db8;
const BLOG_POSTS = [{
  title: "What an audit trail has to contain before an agent can touch a ledger",
  category: "Policy",
  date: "12 Jul 2026",
  read: "8 min",
  tone: "chalk"
}, {
  title: "Grounding retrieval in systems of record, not in a document dump",
  category: "Research",
  date: "28 Jun 2026",
  read: "11 min",
  tone: "lilac"
}, {
  title: "Review queues: the interface that decides whether agents get adopted",
  category: "Product",
  date: "14 Jun 2026",
  read: "6 min",
  tone: "sand"
}, {
  title: "Evaluating tool use when the environment answers slowly",
  category: "Research",
  date: "2 Jun 2026",
  read: "9 min",
  tone: "chalk"
}, {
  title: "Maue 3 Compact is available for high-volume triage",
  category: "Product",
  date: "21 May 2026",
  read: "4 min",
  tone: "sand"
}, {
  title: "Model residency requirements, written plainly",
  category: "Policy",
  date: "9 May 2026",
  read: "7 min",
  tone: "lilac"
}];
const CATEGORIES = ["All", "Research", "Product", "Policy"];
function BlogScreen() {
  const [active, setActive] = React.useState("All");
  const posts = active === "All" ? BLOG_POSTS : BLOG_POSTS.filter(p => p.category === active);
  const count = c => c === "All" ? BLOG_POSTS.length : BLOG_POSTS.filter(p => p.category === c).length;
  return /*#__PURE__*/React.createElement("main", null, /*#__PURE__*/React.createElement(Section, {
    py: "80px"
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      font: "var(--type-product-display)",
      letterSpacing: "var(--track-product-display)",
      color: "var(--text-heading)",
      maxWidth: "14ch"
    }
  }, "Blog"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: "var(--space-md)",
      marginTop: "var(--space-40)"
    }
  }, CATEGORIES.map(c => /*#__PURE__*/React.createElement(BlogFilterChip, {
    key: c,
    active: active === c,
    count: count(c),
    onClick: () => setActive(c)
  }, c))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,minmax(0,1fr))",
      gap: "var(--space-40)",
      marginTop: "var(--space-56)"
    }
  }, posts.map(p => /*#__PURE__*/React.createElement("article", {
    key: p.title,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-lg)"
    }
  }, /*#__PURE__*/React.createElement(HeroPhotoCard, {
    radius: "sm",
    ratio: "4 / 3",
    tone: p.tone,
    label: p.category
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-md)",
      font: "var(--type-caption)",
      color: "var(--text-meta)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-taxonomy)"
    }
  }, p.category), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      color: "var(--hairline)"
    }
  }, "/"), /*#__PURE__*/React.createElement("span", null, p.date), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      color: "var(--hairline)"
    }
  }, "/"), /*#__PURE__*/React.createElement("span", null, p.read)), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      font: "var(--type-feature-heading)",
      color: "var(--text-heading)",
      textWrap: "pretty"
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: e => e.preventDefault(),
    style: {
      color: "inherit",
      textDecoration: "none"
    }
  }, p.title))))), posts.length === 0 ? /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: "var(--space-40)",
      font: "var(--type-body-lg)",
      color: "var(--text-meta)"
    }
  }, "No posts in this category yet.") : null, /*#__PURE__*/React.createElement(Pagination, {
    page: 1,
    pages: 4
  })), /*#__PURE__*/React.createElement(Section, {
    tone: "sand",
    py: "120px"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "var(--space-64)",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-xl)",
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono-label)",
      letterSpacing: "var(--track-mono-label)",
      textTransform: "uppercase",
      color: "var(--marigold)"
    }
  }, "Dispatch"), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: "var(--type-section-heading)",
      letterSpacing: "var(--track-section-heading)",
      color: "var(--text-heading)",
      textWrap: "balance"
    }
  }, "Research and product notes, monthly"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--type-body)",
      color: "var(--text-muted)",
      maxWidth: "44ch"
    }
  }, "No product marketing. Unsubscribe in one click."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-xl)"
    }
  }, /*#__PURE__*/React.createElement(ButtonPrimary, null, "Subscribe"), /*#__PURE__*/React.createElement(ButtonSecondary, {
    withArrow: true
  }, "Browse the archive"))), /*#__PURE__*/React.createElement(HeroPhotoCard, {
    ratio: "16 / 10",
    tone: "chalk",
    label: "Abstract 3D render"
  }))));
}
Object.assign(window, {
  BlogScreen,
  BLOG_POSTS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/BlogScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/ContactScreen.jsx
try { (() => {
const {
  ContactFormCard,
  Icon
} = window.MaueDesignSystem_961db8;
const CONTACT_DETAILS = [{
  icon: "mail",
  label: "Sales",
  value: "sales@maue.example"
}, {
  icon: "life-buoy",
  label: "Support",
  value: "support@maue.example"
}, {
  icon: "map-pin",
  label: "Offices",
  value: "New York · London · Singapore"
}];
function ContactScreen() {
  return /*#__PURE__*/React.createElement("main", null, /*#__PURE__*/React.createElement("section", {
    style: {
      background: "var(--surface-band-indigo)",
      padding: "100px var(--gutter) var(--section-y)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container-max)",
      margin: "0 auto",
      display: "grid",
      gridTemplateColumns: "1fr 1.15fr",
      gap: "var(--space-64)",
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-xl)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono-label)",
      letterSpacing: "var(--track-mono-label)",
      textTransform: "uppercase",
      color: "var(--on-dark-muted)"
    }
  }, "Contact"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      font: "var(--type-section-heading)",
      letterSpacing: "var(--track-section-heading)",
      color: "var(--text-on-dark)",
      textWrap: "balance"
    }
  }, "Bring a workflow, not a wishlist"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--type-body-lg)",
      color: "var(--on-dark-muted)",
      maxWidth: "46ch",
      textWrap: "pretty"
    }
  }, "Tell us the process, the systems it touches and who signs off today. We will show the run, the audit trail and where it fails."), /*#__PURE__*/React.createElement("dl", {
    style: {
      margin: "var(--space-xl) 0 0",
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-xl)"
    }
  }, CONTACT_DETAILS.map(d => /*#__PURE__*/React.createElement("div", {
    key: d.label,
    style: {
      display: "flex",
      gap: "var(--space-lg)",
      alignItems: "flex-start",
      paddingTop: "var(--space-lg)",
      borderTop: "var(--rule-on-dark)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-on-dark)",
      paddingTop: 2
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: d.icon,
    size: 20
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("dt", {
    style: {
      font: "var(--type-micro)",
      color: "var(--on-dark-muted)"
    }
  }, d.label), /*#__PURE__*/React.createElement("dd", {
    style: {
      margin: "4px 0 0",
      font: "var(--type-body)",
      color: "var(--text-on-dark)"
    }
  }, d.value)))))), /*#__PURE__*/React.createElement(ContactFormCard, {
    title: "Talk to sales",
    description: "Two-column rows, thin gray inputs, one near-black submit.",
    fields: [{
      name: "first",
      label: "First name",
      required: true,
      placeholder: "Ada"
    }, {
      name: "last",
      label: "Last name",
      required: true,
      placeholder: "Okonkwo"
    }, {
      name: "email",
      label: "Work email",
      type: "email",
      required: true,
      placeholder: "ada@company.com"
    }, {
      name: "company",
      label: "Company",
      required: true,
      placeholder: "Northwind"
    }, {
      name: "size",
      label: "Company size",
      type: "select",
      options: ["1–200", "200–2,000", "2,000+"]
    }, {
      name: "industry",
      label: "Industry",
      type: "select",
      options: ["Financial services", "Healthcare", "Public sector", "Other"]
    }, {
      name: "notes",
      label: "What are you trying to automate?",
      type: "textarea",
      rows: 4,
      placeholder: "Optional"
    }],
    submitLabel: "Submit",
    footnote: "We reply within one business day.",
    sentMessage: "Thanks \u2014 we'll be in touch within one business day."
  }))));
}
Object.assign(window, {
  ContactScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/ContactScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/HomeScreen.jsx
try { (() => {
const {
  ButtonPrimary,
  ButtonSecondary,
  HeroPhotoCard,
  AgentConsoleCard,
  TrustLogoStrip,
  CapabilityCard,
  ProductCard,
  DarkFeatureBand,
  Icon
} = window.MaueDesignSystem_961db8;
function HomeScreen({
  onNavigate
}) {
  return /*#__PURE__*/React.createElement("main", null, /*#__PURE__*/React.createElement(Section, {
    py: "120px"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "var(--space-xl)",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      font: "var(--type-hero)",
      letterSpacing: "var(--track-hero)",
      color: "var(--text-heading)",
      maxWidth: "16ch",
      textWrap: "balance"
    }
  }, "Agent infrastructure for regulated work"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--type-body-lg)",
      color: "var(--text-muted)",
      maxWidth: "58ch",
      textWrap: "pretty"
    }
  }, "Maue runs agents inside your systems of record, where every action is attributable, reversible and logged."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-xl)",
      marginTop: "var(--space-sm)"
    }
  }, /*#__PURE__*/React.createElement(ButtonPrimary, {
    onClick: () => onNavigate("Contact")
  }, "Book a demo"), /*#__PURE__*/React.createElement(ButtonSecondary, {
    withArrow: true,
    onClick: () => onNavigate("Platform")
  }, "Explore the platform"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.62fr 1fr",
      gap: "var(--space-xl)",
      marginTop: "var(--space-64)"
    }
  }, /*#__PURE__*/React.createElement(HeroPhotoCard, {
    ratio: "16 / 10",
    tone: "chalk",
    label: "Product environment",
    overlay: /*#__PURE__*/React.createElement(AgentConsoleCard, {
      compact: true,
      agentName: "Reconciliation agent",
      status: "Running",
      integrations: ["Snowflake", "NetSuite", "Slack"],
      prompt: "Reconcile Q3 intercompany entries",
      response: {
        title: "Response",
        lines: ["Draft summary ready for review.", "3 exceptions flagged"],
        bars: true
      }
    })
  }), /*#__PURE__*/React.createElement(HeroPhotoCard, {
    ratio: "4 / 5",
    tone: "sand",
    label: "Enterprise photography"
  }))), /*#__PURE__*/React.createElement(Section, {
    py: "var(--section-y-airy)"
  }, /*#__PURE__*/React.createElement(TrustLogoStrip, {
    caption: "Deployed inside regulated enterprises.",
    logos: ["Northwind", "Aster Bank", "Verdant", "Lumen Health", "Calder Group"]
  })), /*#__PURE__*/React.createElement(Section, null, /*#__PURE__*/React.createElement(SectionHead, {
    eyebrow: "Platform",
    title: "Work that can be checked, line by line",
    body: "Agents call your systems directly, and every step they take stays inspectable after the fact."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,minmax(0,1fr))",
      gap: "var(--space-40)",
      marginTop: "var(--space-56)"
    }
  }, /*#__PURE__*/React.createElement(CapabilityCard, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "workflow",
      size: 28
    }),
    title: "Orchestration",
    body: "Route work across ERP, warehouse and messaging without glue code.",
    linkLabel: "Read the docs"
  }), /*#__PURE__*/React.createElement(CapabilityCard, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "database",
      size: 28
    }),
    title: "Grounding",
    body: "Answers cite the record they came from, not a summary of it.",
    linkLabel: "How grounding works"
  }), /*#__PURE__*/React.createElement(CapabilityCard, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "shield-check",
      size: 28
    }),
    title: "Controls",
    body: "Scoped permissions, reversible actions, exportable audit trail.",
    linkLabel: "Security overview"
  }))), /*#__PURE__*/React.createElement(DarkFeatureBand, {
    layout: "split",
    tone: "indigo",
    eyebrow: "Workspace",
    title: "One place to review what agents did",
    body: "Every run arrives as a reviewable draft: the prompt, the systems it touched, the records it changed, and the exceptions it could not resolve.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ButtonPrimary, {
      onSurface: "dark",
      onClick: () => onNavigate("Platform")
    }, "Explore the platform"), /*#__PURE__*/React.createElement(ButtonSecondary, {
      onSurface: "dark",
      withArrow: true
    }, "Open the sandbox")),
    media: /*#__PURE__*/React.createElement(AgentConsoleCard, {
      agentName: "Close agent",
      status: "Needs review",
      statusTone: "done",
      integrations: ["NetSuite", "Workday"],
      prompt: "Prepare the month-end close packet",
      response: {
        title: "Draft output",
        lines: ["12 journal entries prepared.", "2 require an approver"],
        bars: true
      }
    })
  }), /*#__PURE__*/React.createElement(Section, null, /*#__PURE__*/React.createElement(SectionHead, {
    align: "center",
    eyebrow: "Maue 3",
    title: "Three ways to deploy"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,minmax(0,1fr))",
      gap: "var(--space-xl)",
      marginTop: "var(--space-56)"
    }
  }, /*#__PURE__*/React.createElement(ProductCard, {
    eyebrow: "Sandbox",
    title: "Evaluate",
    description: "A scoped environment with synthetic records and no production access.",
    actionLabel: "Open the sandbox",
    features: ["Synthetic data set", "Shared evaluation harness", "No integration work"]
  }), /*#__PURE__*/React.createElement(ProductCard, {
    eyebrow: "Workspace",
    title: "Deploy",
    description: "Agents in your tenancy, with review queues for every action.",
    actionLabel: "Book a demo",
    features: ["SOC 2 Type II", "SSO and SCIM", "Reviewer approvals", "Audit trail export"],
    featured: true
  }), /*#__PURE__*/React.createElement(ProductCard, {
    eyebrow: "Platform",
    title: "Embed",
    description: "The same runtime behind your own product surfaces.",
    actionLabel: "Read the docs",
    features: ["Private VPC deploy", "Model routing controls", "Usage attribution"]
  }))), /*#__PURE__*/React.createElement(Section, {
    tone: "chalk",
    py: "var(--section-y-airy)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.2fr 1fr",
      gap: "var(--space-64)",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-xl)",
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: "var(--type-section-display)",
      letterSpacing: "var(--track-section-display)",
      color: "var(--text-heading)",
      textWrap: "balance"
    }
  }, "Start with one workflow"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--type-body-lg)",
      color: "var(--text-muted)",
      maxWidth: "48ch"
    }
  }, "Most teams begin with a single reconciliation or intake process, then widen scope once the audit trail holds up."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-xl)"
    }
  }, /*#__PURE__*/React.createElement(ButtonPrimary, {
    onClick: () => onNavigate("Contact")
  }, "Book a demo"), /*#__PURE__*/React.createElement(ButtonSecondary, {
    withArrow: true,
    onClick: () => onNavigate("Research")
  }, "Read the research"))), /*#__PURE__*/React.createElement(HeroPhotoCard, {
    ratio: "4 / 3",
    tone: "lilac",
    label: "Abstract 3D render"
  }))));
}
Object.assign(window, {
  HomeScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/HomeScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/PlatformScreen.jsx
try { (() => {
const {
  ButtonPrimary,
  ButtonSecondary,
  HeroPhotoCard,
  AgentConsoleCard,
  TrustLogoStrip,
  CapabilityCard,
  ProductCard,
  DarkFeatureBand,
  ContactFormCard,
  Icon
} = window.MaueDesignSystem_961db8;
function PlatformScreen({
  onNavigate
}) {
  return /*#__PURE__*/React.createElement("main", null, /*#__PURE__*/React.createElement(Section, {
    py: "100px"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "var(--space-xl)",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono-label)",
      letterSpacing: "var(--track-mono-label)",
      textTransform: "uppercase",
      color: "var(--slate)"
    }
  }, "Platform"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      font: "var(--type-product-display)",
      letterSpacing: "var(--track-product-display)",
      color: "var(--text-heading)",
      maxWidth: "18ch",
      textWrap: "balance"
    }
  }, "The runtime under every Maue agent"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--type-body-lg)",
      color: "var(--text-muted)",
      maxWidth: "60ch",
      textWrap: "pretty"
    }
  }, "Model routing, tool permissions, grounding and review \u2014 one runtime, deployed in your tenancy."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-xl)",
      marginTop: "var(--space-sm)"
    }
  }, /*#__PURE__*/React.createElement(ButtonPrimary, {
    onClick: () => onNavigate("Contact")
  }, "Book a demo"), /*#__PURE__*/React.createElement(ButtonSecondary, {
    withArrow: true
  }, "Read the docs"))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--space-64)"
    }
  }, /*#__PURE__*/React.createElement(HeroPhotoCard, {
    ratio: "21 / 9",
    tone: "ink",
    label: "Platform environment"
  }))), /*#__PURE__*/React.createElement(Section, {
    py: "120px"
  }, /*#__PURE__*/React.createElement(TrustLogoStrip, {
    caption: "Running in production at",
    logos: ["Northwind", "Aster Bank", "Verdant", "Lumen Health"]
  })), /*#__PURE__*/React.createElement(DarkFeatureBand, {
    layout: "split",
    tone: "indigo",
    eyebrow: "Grounding",
    title: "Answers that point back at the record",
    body: "Retrieval runs against your systems of record, and every claim in an output carries the row it came from. Reviewers open the source without leaving the queue.",
    actions: /*#__PURE__*/React.createElement(ButtonSecondary, {
      onSurface: "dark",
      withArrow: true
    }, "How grounding works"),
    media: /*#__PURE__*/React.createElement(AgentConsoleCard, {
      agentName: "Intake agent",
      status: "Grounded",
      statusTone: "done",
      integrations: ["Snowflake", "SharePoint"],
      prompt: "Summarise the counterparty exposure",
      response: {
        title: "Cited output",
        lines: ["4 sources referenced.", "All rows resolved to a system of record"],
        bars: true
      }
    })
  }), /*#__PURE__*/React.createElement(Section, null, /*#__PURE__*/React.createElement(SectionHead, {
    eyebrow: "Capabilities",
    title: "What the runtime handles",
    body: "The parts you would otherwise build twice."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,minmax(0,1fr))",
      gap: "var(--space-40)",
      marginTop: "var(--space-56)"
    }
  }, /*#__PURE__*/React.createElement(CapabilityCard, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "git-branch",
      size: 28
    }),
    title: "Model routing",
    body: "Route by task, cost ceiling and data residency.",
    linkLabel: "Routing reference"
  }), /*#__PURE__*/React.createElement(CapabilityCard, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "lock",
      size: 28
    }),
    title: "Tool permissions",
    body: "Scope every tool call to a role, a system and a record set.",
    linkLabel: "Permissions model"
  }), /*#__PURE__*/React.createElement(CapabilityCard, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "file-text",
      size: 28
    }),
    title: "Review queues",
    body: "Nothing lands in production without an approver, if you want it that way.",
    linkLabel: "Review flows"
  }), /*#__PURE__*/React.createElement(CapabilityCard, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "database",
      size: 28
    }),
    title: "Connectors",
    body: "Warehouse, ERP, ticketing and messaging, with schema awareness.",
    linkLabel: "Connector list"
  }), /*#__PURE__*/React.createElement(CapabilityCard, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "circle-check",
      size: 28
    }),
    title: "Evaluation",
    body: "Run the same harness in the sandbox and in production.",
    linkLabel: "Evaluation guide"
  }), /*#__PURE__*/React.createElement(CapabilityCard, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "settings",
      size: 28
    }),
    title: "Usage attribution",
    body: "Spend and actions attributed per team, per workflow.",
    linkLabel: "Attribution docs"
  }))), /*#__PURE__*/React.createElement(DarkFeatureBand, {
    tone: "clay",
    eyebrow: "Security",
    title: "Controls that survive an audit",
    body: "Private deployment, scoped credentials, reversible actions, and an export your auditors can read without our help.",
    actions: /*#__PURE__*/React.createElement(ButtonPrimary, {
      onSurface: "dark",
      onClick: () => onNavigate("Contact")
    }, "Talk to sales")
  }, /*#__PURE__*/React.createElement(CapabilityCard, {
    onSurface: "dark",
    title: "Private VPC deploy",
    body: "Single-tenant runtime inside your network boundary."
  }), /*#__PURE__*/React.createElement(CapabilityCard, {
    onSurface: "dark",
    title: "Attribution",
    body: "Per-action lineage from prompt to record change."
  }), /*#__PURE__*/React.createElement(CapabilityCard, {
    onSurface: "dark",
    title: "Reversibility",
    body: "Every write has a documented undo path."
  })), /*#__PURE__*/React.createElement(Section, null, /*#__PURE__*/React.createElement(SectionHead, {
    align: "center",
    eyebrow: "Models",
    title: "Pick the tier that fits the workflow"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,minmax(0,1fr))",
      gap: "var(--space-xl)",
      marginTop: "var(--space-56)"
    }
  }, /*#__PURE__*/React.createElement(ProductCard, {
    eyebrow: "Maue 3 Compact",
    title: "Fast classification",
    description: "High-volume triage, extraction and routing.",
    features: ["Lowest latency", "Batch throughput", "Structured output"],
    actionLabel: "Read the docs"
  }), /*#__PURE__*/React.createElement(ProductCard, {
    eyebrow: "Maue 3",
    title: "General reasoning",
    description: "The default for multi-step workflows with tool use.",
    features: ["Tool use", "Long context", "Review-ready drafts"],
    actionLabel: "Book a demo",
    featured: true
  }), /*#__PURE__*/React.createElement(ProductCard, {
    eyebrow: "Maue 3 Deep",
    title: "Long-horizon work",
    description: "Multi-hour runs with checkpointing and handoff.",
    features: ["Checkpointed runs", "Human handoff", "Full trace export"],
    actionLabel: "Talk to sales"
  }))), /*#__PURE__*/React.createElement("section", {
    style: {
      background: "var(--surface-band-indigo)",
      padding: "var(--section-y) var(--gutter)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container-max)",
      margin: "0 auto",
      display: "grid",
      gridTemplateColumns: "1fr 1.15fr",
      gap: "var(--space-64)",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-lg)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono-label)",
      letterSpacing: "var(--track-mono-label)",
      textTransform: "uppercase",
      color: "var(--on-dark-muted)"
    }
  }, "Get started"), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: "var(--type-section-heading)",
      letterSpacing: "var(--track-section-heading)",
      color: "var(--text-on-dark)",
      textWrap: "balance"
    }
  }, "See it against your own process"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--type-body-lg)",
      color: "var(--on-dark-muted)",
      maxWidth: "44ch"
    }
  }, "Bring one workflow and a sample of records. We will show the run, the trail and the failure modes.")), /*#__PURE__*/React.createElement(ContactFormCard, {
    title: "Book a demo",
    fields: [{
      name: "first",
      label: "First name",
      required: true,
      placeholder: "Ada"
    }, {
      name: "last",
      label: "Last name",
      required: true,
      placeholder: "Okonkwo"
    }, {
      name: "email",
      label: "Work email",
      type: "email",
      required: true,
      span: 2,
      placeholder: "ada@company.com"
    }, {
      name: "workflow",
      label: "Which workflow?",
      type: "textarea",
      rows: 3,
      placeholder: "Optional"
    }],
    submitLabel: "Submit",
    footnote: "We reply within one business day."
  }))));
}
Object.assign(window, {
  PlatformScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/PlatformScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/ResearchScreen.jsx
try { (() => {
const {
  ButtonPillOutline,
  ResearchTable,
  Icon
} = window.MaueDesignSystem_961db8;
const PAPERS = [{
  title: "Attributable agent actions in regulated workflows",
  authors: "Maue Research",
  topics: ["Safety", "Systems"],
  date: "Jun 2026"
}, {
  title: "Evaluating tool use under partial observability",
  authors: "Maue Research",
  topics: ["Evaluation"],
  date: "Apr 2026"
}, {
  title: "Grounding enterprise retrieval in systems of record",
  authors: "Maue Research",
  topics: ["Retrieval", "Systems"],
  date: "Feb 2026"
}, {
  title: "Reversibility as a design constraint for autonomous writes",
  authors: "Maue Research",
  topics: ["Safety"],
  date: "Jan 2026"
}, {
  title: "Cost-aware routing across heterogeneous model tiers",
  authors: "Maue Research",
  topics: ["Systems", "Evaluation"],
  date: "Nov 2025"
}, {
  title: "Interpreting refusal behaviour in tool-using agents",
  authors: "Maue Research",
  topics: ["Interpretability", "Safety"],
  date: "Sep 2025"
}];
const TOPICS = ["All topics", "Safety", "Systems", "Evaluation", "Retrieval", "Interpretability", "Alignment"];
function ResearchScreen() {
  const [topic, setTopic] = React.useState("All topics");
  const [query, setQuery] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const rows = PAPERS.filter(p => (topic === "All topics" || (p.topics || []).includes(topic)) && (query.trim() === "" || p.title.toLowerCase().includes(query.trim().toLowerCase())));
  return /*#__PURE__*/React.createElement("main", null, /*#__PURE__*/React.createElement(Section, {
    py: "80px"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-xl)",
      maxWidth: 820
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono-label)",
      letterSpacing: "var(--track-mono-label)",
      textTransform: "uppercase",
      color: "var(--slate)"
    }
  }, "Research"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      font: "var(--type-product-display)",
      letterSpacing: "var(--track-product-display)",
      color: "var(--text-heading)",
      textWrap: "balance"
    }
  }, "Publications"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--type-body-lg)",
      color: "var(--text-muted)",
      maxWidth: "62ch"
    }
  }, "Work on agent reliability, evaluation and the controls enterprises need before autonomy is acceptable.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "var(--space-lg)",
      marginTop: "var(--space-40)"
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-sm)",
      padding: "10px 14px",
      border: "1px solid " + (focused ? "var(--border-input-focus)" : "var(--hairline)"),
      borderRadius: "var(--radius-xs)",
      minWidth: 280,
      transition: "var(--transition-color)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 16,
    color: "var(--slate)"
  }), /*#__PURE__*/React.createElement("input", {
    value: query,
    onChange: e => setQuery(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    placeholder: "Search publications",
    style: {
      border: "none",
      outline: "none",
      background: "transparent",
      font: "var(--type-body)",
      color: "var(--text-body)",
      width: "100%"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: "var(--space-sm)"
    }
  }, TOPICS.map(t => /*#__PURE__*/React.createElement(ButtonPillOutline, {
    key: t,
    selected: topic === t,
    onClick: () => setTopic(t)
  }, t)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--space-40)"
    }
  }, /*#__PURE__*/React.createElement(ResearchTable, {
    columnLabels: ["Publication", "Topics", "Date"],
    rows: rows
  }), rows.length === 0 ? /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: "var(--space-xl)",
      font: "var(--type-body-lg)",
      color: "var(--text-meta)"
    }
  }, "Nothing matches that filter.") : null), /*#__PURE__*/React.createElement(Pagination, {
    page: 1,
    pages: 3
  })));
}
Object.assign(window, {
  ResearchScreen,
  PAPERS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/ResearchScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/SiteNav.jsx
try { (() => {
const {
  ButtonPrimary,
  Icon
} = window.MaueDesignSystem_961db8;
const NAV_ITEMS = ["Platform", "Research", "Blog", "Contact"];
const navShell = {
  position: "sticky",
  top: 0,
  zIndex: 20,
  display: "grid",
  gridTemplateColumns: "minmax(180px,auto) 1fr minmax(180px,auto)",
  alignItems: "center",
  height: "var(--nav-height)",
  padding: "0 var(--gutter)",
  background: "var(--canvas)",
  borderBottom: "var(--rule-card)"
};
function SiteNav({
  current,
  onNavigate
}) {
  const [hovered, setHovered] = React.useState(null);
  return /*#__PURE__*/React.createElement("header", {
    style: navShell
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: e => {
      e.preventDefault();
      onNavigate("Home");
    },
    style: {
      fontFamily: "var(--font-display)",
      fontSize: 22,
      fontWeight: 400,
      letterSpacing: "-0.5px",
      color: "var(--text-strong)",
      textDecoration: "none"
    }
  }, "Maue"), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      justifyContent: "center",
      gap: "var(--space-xxl)"
    }
  }, NAV_ITEMS.map(item => {
    const active = current === item;
    return /*#__PURE__*/React.createElement("a", {
      key: item,
      href: "#",
      onClick: e => {
        e.preventDefault();
        onNavigate(item);
      },
      onMouseEnter: () => setHovered(item),
      onMouseLeave: () => setHovered(null),
      style: {
        font: "var(--type-body)",
        color: "var(--text-body)",
        textDecoration: active || hovered === item ? "underline" : "none",
        textUnderlineOffset: "6px",
        textDecorationThickness: "1px",
        opacity: active ? 1 : 0.82,
        transition: "var(--transition-color)"
      }
    }, item);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: "var(--space-lg)"
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: e => e.preventDefault(),
    style: {
      font: "var(--type-body)",
      color: "var(--text-body)",
      textDecoration: "none",
      whiteSpace: "nowrap"
    }
  }, "Sign in"), /*#__PURE__*/React.createElement(ButtonPrimary, {
    size: "sm",
    onClick: () => onNavigate("Contact")
  }, "Book a demo")));
}

/** Section wrapper used by every screen: 1280px container on the 80px vertical rhythm. */
function Section({
  children,
  tone = "canvas",
  py = "var(--section-y)",
  style
}) {
  const bg = {
    canvas: "var(--canvas)",
    chalk: "var(--warm-chalk)",
    lilac: "var(--pale-lilac)",
    sand: "var(--pale-sand)"
  }[tone] || "var(--canvas)";
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: bg,
      padding: py + " var(--gutter)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container-max)",
      margin: "0 auto"
    }
  }, children));
}
function SectionHead({
  eyebrow,
  title,
  body,
  align = "start",
  maxWidth = 720
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-lg)",
      alignItems: align === "center" ? "center" : "flex-start",
      textAlign: align === "center" ? "center" : "left",
      maxWidth: align === "center" ? "none" : maxWidth,
      marginInline: align === "center" ? "auto" : undefined
    }
  }, eyebrow ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-mono-label)",
      letterSpacing: "var(--track-mono-label)",
      textTransform: "uppercase",
      color: "var(--slate)"
    }
  }, eyebrow) : null, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: "var(--type-section-heading)",
      letterSpacing: "var(--track-section-heading)",
      color: "var(--text-heading)",
      textWrap: "balance",
      maxWidth: 780
    }
  }, title), body ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: "var(--type-body-lg)",
      color: "var(--text-muted)",
      maxWidth: 620,
      textWrap: "pretty"
    }
  }, body) : null);
}
function Pagination({
  page = 1,
  pages = 4,
  onChange
}) {
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-xl)",
      marginTop: "var(--space-56)",
      paddingTop: "var(--space-xl)",
      borderTop: "var(--rule-1)"
    }
  }, Array.from({
    length: pages
  }, (_, i) => i + 1).map(n => /*#__PURE__*/React.createElement("a", {
    key: n,
    href: "#",
    onClick: e => {
      e.preventDefault();
      if (onChange) onChange(n);
    },
    style: {
      font: "var(--type-body)",
      color: n === page ? "var(--text-body)" : "var(--text-link)",
      textDecoration: n === page ? "none" : "underline",
      textUnderlineOffset: "4px"
    }
  }, n)), /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: e => e.preventDefault(),
    style: {
      marginLeft: "auto",
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--space-sm)",
      font: "var(--type-body)",
      color: "var(--text-link)",
      textDecoration: "none"
    }
  }, "Next ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 16
  })));
}
Object.assign(window, {
  SiteNav,
  Section,
  SectionHead,
  Pagination,
  NAV_ITEMS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/SiteNav.jsx", error: String((e && e.message) || e) }); }

__ds_ns.ButtonPillOutline = __ds_scope.ButtonPillOutline;

__ds_ns.ButtonPrimary = __ds_scope.ButtonPrimary;

__ds_ns.ButtonSecondary = __ds_scope.ButtonSecondary;

__ds_ns.CapabilityCard = __ds_scope.CapabilityCard;

__ds_ns.DarkFeatureBand = __ds_scope.DarkFeatureBand;

__ds_ns.ProductCard = __ds_scope.ProductCard;

__ds_ns.BlogFilterChip = __ds_scope.BlogFilterChip;

__ds_ns.ResearchTable = __ds_scope.ResearchTable;

__ds_ns.ContactFormCard = __ds_scope.ContactFormCard;

__ds_ns.AgentConsoleCard = __ds_scope.AgentConsoleCard;

__ds_ns.HeroPhotoCard = __ds_scope.HeroPhotoCard;

__ds_ns.HeroPhotoCardOverlayNote = __ds_scope.HeroPhotoCardOverlayNote;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.AnnouncementBar = __ds_scope.AnnouncementBar;

__ds_ns.FooterNewsletter = __ds_scope.FooterNewsletter;

__ds_ns.TrustLogoStrip = __ds_scope.TrustLogoStrip;

})();
