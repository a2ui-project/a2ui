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

import React, {useState, useEffect, useRef} from 'react';
import {createComponentImplementation} from '../../../adapter';
import {ModalApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {useBasicCatalogStyles} from '../utils';

export const Modal = createComponentImplementation(ModalApi, ({props, buildChild}) => {
  useBasicCatalogStyles();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const isMounted = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      if (isMounted.current && triggerRef.current) {
        const focusable = triggerRef.current.querySelector(
          'button, [tabindex="0"], input, select, textarea'
        ) as HTMLElement;
        if (focusable) {
          focusable.focus();
        }
      }
      return;
    }

    isMounted.current = true;

    if (modalRef.current) {
      const focusables = modalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex="0"]'
      );
      if (focusables.length > 0) {
        (focusables[0] as HTMLElement).focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        return;
      }
      if (e.key === 'Tab' && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex="0"]'
        );
        if (focusables.length === 0) return;
        const first = focusables[0] as HTMLElement;
        const last = focusables[focusables.length - 1] as HTMLElement;

        if (e.shiftKey) {
          if (document.activeElement === first) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const uniqueId = React.useId();

  return (
    <>
      <div
        ref={triggerRef}
        className="a2ui-modal-trigger"
        onClick={() => setIsOpen(true)}
        style={{display: 'inline-block'}}
      >
        {props.trigger ? buildChild(props.trigger) : null}
      </div>
      {isOpen && (
        <div
          className="a2ui-modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'var(--a2ui-modal-overlay-color, rgba(0, 0, 0, 0.5))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setIsOpen(false)}
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label={props.accessibility?.label}
            aria-describedby={props.accessibility?.description ? `${uniqueId}-description` : undefined}
            style={{
              backgroundColor: 'var(--a2ui-color-surface, #fff)',
              padding: 'var(--a2ui-modal-padding, var(--a2ui-spacing-l, 24px))',
              borderRadius: 'var(--a2ui-modal-border-radius, var(--a2ui-border-radius, 8px))',
              maxWidth: '90%',
              maxHeight: '90%',
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              color: 'var(--a2ui-color-on-surface, inherit)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{display: 'flex', justifyContent: 'flex-end'}}>
              <button
                className="a2ui-modal-close"
                onClick={() => setIsOpen(false)}
                aria-label="Close"
                style={{
                  border: 'none',
                  background: 'none',
                  fontSize: 'var(--a2ui-font-size-xl, 1.5rem)',
                  cursor: 'pointer',
                  padding: 'var(--a2ui-spacing-xs, 4px)',
                  color: 'var(--a2ui-color-on-surface, inherit)',
                }}
              >
                &times;
              </button>
            </div>
            <div style={{flex: 1}}>{props.content ? buildChild(props.content) : null}</div>
            {props.accessibility?.description && (
              <span id={`${uniqueId}-description`} style={{display: 'none'}}>
                {props.accessibility.description}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
});
