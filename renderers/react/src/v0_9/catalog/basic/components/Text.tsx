/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {createComponentImplementation} from '../../../adapter';
import {TextApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {getBaseLeafStyle, getWeightStyle, useBasicCatalogStyles} from '../utils';
import {useMarkdown} from '../hooks/useMarkdown';

// Import CSS Module
import styles from './Text.module.css';

/** Variants rendered with declarative HTML instead of the Markdown pipeline. */
const NON_MARKDOWN_VARIANTS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'caption']);

/** Renders text through the Markdown pipeline for unknown/default variants. */
function MarkdownText({
  text,
  className,
  style,
}: {
  text: string;
  className: string;
  style: React.CSSProperties;
}) {
  const renderedHtml = useMarkdown(text);
  const classes = renderedHtml === null ? `${className} no-markdown-renderer` : className;
  const contentProps =
    renderedHtml !== null ? {dangerouslySetInnerHTML: {__html: renderedHtml}} : {children: text};

  return <div className={classes} style={style} {...contentProps} />;
}

/** Renders known variants (h1–h5, caption) as native HTML elements without Markdown. */
function NonMarkdownText({
  text,
  variant,
  className,
  style,
}: {
  text: string;
  variant: string;
  className: string;
  style: React.CSSProperties;
}) {
  const isCaption = variant === 'caption';
  const HeadingTag = isCaption ? 'em' : (variant as 'h1' | 'h2' | 'h3' | 'h4' | 'h5');
  if (isCaption) {
    return (
      <span className={className} style={style}>
        <HeadingTag>{text}</HeadingTag>
      </span>
    );
  }
  return (
    <div className={className} style={style}>
      <HeadingTag>{text}</HeadingTag>
    </div>
  );
}

/** Renders text content, using the Markdown pipeline for rich text or native HTML elements for known typographic variants. */
export const Text = createComponentImplementation(TextApi, ({props}) => {
  useBasicCatalogStyles();
  const text = typeof props.text === 'string' ? props.text : String(props.text ?? '');
  const variant = props.variant;

  const style: React.CSSProperties = {
    ...getBaseLeafStyle(),
    ...getWeightStyle(props.weight),
  };

  if (variant && NON_MARKDOWN_VARIANTS.has(variant)) {
    const isCaption = variant === 'caption';
    const className = [styles.a2uiText, isCaption ? styles.a2uiCaption : variant].join(' ');
    return <NonMarkdownText text={text} variant={variant} className={className} style={style} />;
  }

  const className = [styles.a2uiText, variant || 'body'].join(' ');
  return <MarkdownText text={text} className={className} style={style} />;
});
