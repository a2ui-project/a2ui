import React from 'react';
import {z} from 'zod';
import {Catalog, childList} from '@a2ui/web_core/v0_9';
import {createComponentImplementation} from '@a2ui/react/v0_9';

// 1. ProductCard
export const ProductCardApi = {
  name: 'ProductCard',
  schema: z.object({
    title: z.string(),
    price: z.number(),
    image: z.string().optional(),
    inStock: z.boolean().optional(),
    rating: z.number().optional(),
    action: z.any().optional(),
  }),
};

export const ProductCard = createComponentImplementation(
  ProductCardApi,
  ({props}) => {
    return (
      <div
        style={{
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '16px',
          background: '#ffffff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {props.image && (
          <img
            src={props.image}
            alt={props.title}
            style={{
              width: '100%',
              height: '160px',
              objectFit: 'cover',
              borderRadius: '8px',
            }}
          />
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: '16px',
              fontWeight: 600,
              color: '#0f172a',
            }}
          >
            {props.title}
          </h3>
          {props.rating !== undefined && (
            <span
              style={{
                fontSize: '13px',
                fontWeight: 'bold',
                color: '#d97706',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
              }}
            >
              ★ {props.rating.toFixed(1)}
            </span>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 'auto',
          }}
        >
          <span style={{fontSize: '18px', fontWeight: 700, color: '#2563eb'}}>
            ${props.price?.toFixed(2)}
          </span>
          {props.inStock !== undefined && (
            <span
              style={{
                fontSize: '12px',
                fontWeight: 500,
                padding: '3px 10px',
                borderRadius: '12px',
                background: props.inStock ? '#dcfce7' : '#fee2e2',
                color: props.inStock ? '#15803d' : '#b91c1c',
              }}
            >
              {props.inStock ? 'In Stock' : 'Out of Stock'}
            </span>
          )}
        </div>

        {props.action && (
          <button
            style={{
              marginTop: '8px',
              padding: '10px 16px',
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            View Details
          </button>
        )}
      </div>
    );
  },
);

// 2. ProductGrid
export const ProductGridApi = {
  name: 'ProductGrid',
  schema: z.object({
    children: childList({
      description: 'List of ProductCard component IDs to display in grid.',
    }),
    columns: z.number().optional(),
  }),
};

export const ProductGrid = createComponentImplementation(
  ProductGridApi,
  ({props, buildChild}) => {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: '20px',
          padding: '12px 0',
        }}
      >
        {props.children?.map((childRef: any, idx: number) => {
          const id = typeof childRef === 'string' ? childRef : childRef?.id;
          return <div key={idx}>{id ? buildChild(id) : null}</div>;
        })}
      </div>
    );
  },
);

// 3. InventoryBadge
export const InventoryBadgeApi = {
  name: 'InventoryBadge',
  schema: z.object({
    quantity: z.number(),
    status: z.enum(['in_stock', 'low_stock', 'out_of_stock']),
  }),
};

export const InventoryBadge = createComponentImplementation(
  InventoryBadgeApi,
  ({props}) => {
    const statusKey = (props.status as 'in_stock' | 'low_stock' | 'out_of_stock') || 'in_stock';
    const statusMap = {
      in_stock: {
        bg: '#dcfce7',
        text: '#15803d',
        label: `${props.quantity} available`,
      },
      low_stock: {
        bg: '#fef3c7',
        text: '#b45309',
        label: `Low Stock (${props.quantity} left)`,
      },
      out_of_stock: {bg: '#fee2e2', text: '#b91c1c', label: 'Out of Stock'},
    };
    const badgeConfig = statusMap[statusKey];

    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 12px',
          borderRadius: '16px',
          background: badgeConfig.bg,
          color: badgeConfig.text,
          fontSize: '13px',
          fontWeight: 600,
        }}
      >
        ● {badgeConfig.label}
      </span>
    );
  },
);

// 4. PriceTag
export const PriceTagApi = {
  name: 'PriceTag',
  schema: z.object({
    amount: z.number(),
    currency: z.string(),
    discountPercent: z.number().optional(),
  }),
};

export const PriceTag = createComponentImplementation(
  PriceTagApi,
  ({props}) => {
    const symbol = props.currency === 'USD' ? '$' : props.currency;
    return (
      <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
        <span style={{fontSize: '20px', fontWeight: 700, color: '#0f172a'}}>
          {symbol}
          {props.amount?.toFixed(2)}
        </span>
        {props.discountPercent !== undefined && (
          <span
            style={{
              background: '#ef4444',
              color: '#ffffff',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            {props.discountPercent}% OFF
          </span>
        )}
      </div>
    );
  },
);

// 5. CartSummary
export const CartSummaryApi = {
  name: 'CartSummary',
  schema: z.object({
    items: z
      .array(
        z.object({
          title: z.string(),
          price: z.number(),
          quantity: z.number(),
        }),
      )
      .optional(),
    subtotal: z.number(),
    tax: z.number().optional(),
    total: z.number(),
    checkoutAction: z.any().optional(),
  }),
};

export const CartSummary = createComponentImplementation(
  CartSummaryApi,
  ({props}) => {
    return (
      <div
        style={{
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '20px',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <h3 style={{margin: 0, fontSize: '18px', color: '#0f172a'}}>
          Shopping Cart Summary
        </h3>
        {props.items?.map((item: any, idx: number) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '14px',
            }}
          >
            <span>
              {item.title} x {item.quantity}
            </span>
            <span style={{fontWeight: 600}}>
              ${(item.price * item.quantity).toFixed(2)}
            </span>
          </div>
        ))}
        <hr
          style={{
            border: 'none',
            borderTop: '1px solid #cbd5e1',
            margin: '4px 0',
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '14px',
          }}
        >
          <span>Subtotal</span>
          <span>${props.subtotal?.toFixed(2)}</span>
        </div>
        {props.tax !== undefined && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '14px',
            }}
          >
            <span>Estimated Tax</span>
            <span>${props.tax.toFixed(2)}</span>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '18px',
            fontWeight: 700,
            color: '#0f172a',
          }}
        >
          <span>Total</span>
          <span>${props.total?.toFixed(2)}</span>
        </div>
        <button
          style={{
            marginTop: '8px',
            padding: '12px',
            background: '#16a34a',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 700,
            fontSize: '15px',
            cursor: 'pointer',
          }}
        >
          Proceed to Checkout
        </button>
      </div>
    );
  },
);

// Custom Commerce Catalog for A2UI React
export const commerceCatalog = new Catalog(
  'https://a2ui.org/catalogs/commerce/v1.0/catalog.json',
  [ProductCard, ProductGrid, InventoryBadge, PriceTag, CartSummary],
);
