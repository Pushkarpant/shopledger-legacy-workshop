'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var invoice = require('../lib/invoice');
var orders = require('../lib/orders');
var pricing = require('../lib/pricing');
var reports = require('../lib/reports');

function makeInMemoryOrder(items, coupon) {
  var totals = pricing.computeTotals(items, coupon || '');
  var db = { nextOrderId: 1001, orders: [] };
  var order = orders.add(db, {
    date: '2026-11-22',
    customer: 'Test Customer',
    items: items,
    coupon: coupon || '',
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total
  });
  return { db: db, order: order, totals: totals };
}

test('invoice total and GST match the amount billed using the item HSN slab', function () {
  var fixture = makeInMemoryOrder([
    { id: 4, name: 'Indrayani Basmati Rice 5kg', sku: 'GRN-001', hsn: '1006', price: 640, qty: 1 }
  ]);

  var invoiceFigures = invoice.computeInvoiceFigures(fixture.order);
  var html = invoice.render(fixture.order);

  assert.equal(invoiceFigures.tax, fixture.order.tax);
  assert.equal(invoiceFigures.total, fixture.order.total);
  assert.equal(invoiceFigures.rows[0].gstPercent, 5);
  assert.match(html, /<td>CGST<\/td><td class="r">₹16\.00/);
  assert.match(html, /<td>SGST<\/td><td class="r">₹16\.00/);
});

test('invoice uses the HSN slab and matches the billed total', function () {
  // This is the item shape persisted by the order route: HSN is present, gstRate is not.
  var fixture = makeInMemoryOrder([
    { id: 1, name: 'Rice', sku: 'RICE-1', hsn: '1006', price: 100, qty: 2 }
  ]);

  var invoiceFigures = invoice.computeInvoiceFigures(fixture.order);

  assert.equal(fixture.totals.tax, 10);
  assert.equal(fixture.totals.total, 210);
  assert.equal(fixture.order.items[0].gstRate, undefined);
  assert.equal(invoiceFigures.rows[0].gstPercent, 5);
  assert.equal(invoiceFigures.tax, 10);
  assert.equal(invoiceFigures.total, 210);

  var reconciliation = reports.getGstReconciliation(fixture.db);
  assert.equal(reconciliation.mismatchCount, 0);
  assert.equal(reconciliation.rows[0].delta, 0);
  assert.equal(reconciliation.rows[0].matched, true);
});

test('invoice applies a percentage coupon on the same pre-tax basis as billing', function () {
  // Supplying an explicit 18% rate keeps the tax rate equal in both calculations,
  // isolating the percentage coupon base difference.
  var fixture = makeInMemoryOrder([
    { id: 2, name: 'Tea', hsn: '0902', gstRate: 18, price: 100, qty: 2 }
  ], 'WELCOME');

  var invoiceFigures = invoice.computeInvoiceFigures(fixture.order);

  assert.equal(fixture.totals.tax, 34.2);
  assert.equal(fixture.totals.discount, 10);
  assert.equal(fixture.totals.total, 224.2);
  assert.equal(invoiceFigures.tax, fixture.totals.tax);
  assert.equal(invoiceFigures.discount, fixture.totals.discount);
  assert.equal(invoiceFigures.total, 224.2);
});

test('invoice renders its CGST and SGST amounts separately', function () {
  var fixture = makeInMemoryOrder([
    { id: 3, name: 'Tea', hsn: '0902', gstRate: 18, price: 100, qty: 1 }
  ]);

  var invoiceFigures = invoice.computeInvoiceFigures(fixture.order);
  var html = invoice.render(fixture.order);

  assert.equal(invoiceFigures.cgst, 9);
  assert.equal(invoiceFigures.sgst, 9);
  assert.match(html, /<td>CGST<\/td><td class="r">₹9\.00/);
  assert.match(html, /<td>SGST<\/td><td class="r">₹9\.00/);
  assert.doesNotMatch(html, /CGST \+ SGST \(Total GST\)/);
});
