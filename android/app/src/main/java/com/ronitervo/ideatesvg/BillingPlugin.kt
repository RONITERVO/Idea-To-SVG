package com.ronitervo.ideatesvg

import android.util.Log
import com.android.billingclient.api.*
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "BillingPlugin")
class BillingPlugin : Plugin() {

    private var billingClient: BillingClient? = null
    private var pendingPurchaseCall: PluginCall? = null
    private val purchaseCallLock = Any()

    companion object {
        private const val TAG = "BillingPlugin"
    }

    override fun load() {
        billingClient = BillingClient.newBuilder(context)
            .setListener(purchasesUpdatedListener)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder()
                    .enableOneTimeProducts()
                    .build()
            )
            .build()

        startConnection()
    }

    private fun startConnection() {
        billingClient?.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    Log.d(TAG, "Billing client connected")
                } else {
                    Log.e(TAG, "Billing setup failed: ${result.debugMessage}")
                }
            }

            override fun onBillingServiceDisconnected() {
                Log.w(TAG, "Billing service disconnected, will retry on next call")
            }
        })
    }

    private val purchasesUpdatedListener = PurchasesUpdatedListener { billingResult, purchases ->
        val call = synchronized(purchaseCallLock) {
            val currentCall = pendingPurchaseCall
            pendingPurchaseCall = null
            currentCall
        }

        when (billingResult.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                if (purchases != null && purchases.isNotEmpty()) {
                    if (purchases.size > 1) {
                        Log.w(TAG, "Multiple purchases returned (${purchases.size}); aggregating all purchase metadata")
                    }

                    val purchase = purchases[0]
                    if (purchase.products.size > 1) {
                        Log.w(
                            TAG,
                            "Multiple products returned for purchase ${purchase.purchaseToken}: ${purchase.products.size}"
                        )
                    }

                    val purchaseSummaries = JSArray()
                    val allProductIds = JSArray()
                    for (entry in purchases) {
                        val productIds = JSArray()
                        for (productId in entry.products) {
                            productIds.put(productId)
                            allProductIds.put(productId)
                        }

                        val summary = JSObject().apply {
                            put("purchaseToken", entry.purchaseToken)
                            put("orderId", entry.orderId ?: "")
                            put("productIds", productIds)
                            put("productCount", entry.products.size)
                        }
                        purchaseSummaries.put(summary)
                    }

                    val result = JSObject().apply {
                        put("purchaseToken", purchase.purchaseToken)
                        put("productId", purchase.products.firstOrNull() ?: "")
                        put("orderId", purchase.orderId ?: "")
                        put("purchaseCount", purchases.size)
                        put("productCount", allProductIds.length())
                        put("productIds", allProductIds)
                        put("purchases", purchaseSummaries)
                    }
                    if (call != null) {
                        call.resolve(result)
                    } else {
                        Log.w(TAG, "Billing OK response received but no pending PluginCall was available")
                    }
                } else {
                    call?.reject("Purchase succeeded but no purchases returned")
                }
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> {
                call?.reject("Purchase cancelled by user", "USER_CANCELLED")
            }
            else -> {
                call?.reject(
                    "Purchase failed: ${billingResult.debugMessage}",
                    "BILLING_${billingResult.responseCode}"
                )
            }
        }
    }

    @PluginMethod
    fun queryProducts(call: PluginCall) {
        val productIds = call.getArray("productIds")
        if (productIds == null) {
            call.reject("productIds is required")
            return
        }

        val ids = mutableListOf<String>()
        for (i in 0 until productIds.length()) {
            ids.add(productIds.getString(i))
        }

        ensureConnected(call) {
            val productList = ids.map { id ->
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(id)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            }

            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(productList)
                .build()

            billingClient?.queryProductDetailsAsync(params) { billingResult, queryProductDetailsResult ->
                val productDetailsList = queryProductDetailsResult.productDetailsList
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    val products = JSArray()
                    for (details in productDetailsList) {
                        val pricing = details.oneTimePurchaseOfferDetails
                        val product = JSObject().apply {
                            put("productId", details.productId)
                            put("title", details.title)
                            put("description", details.description)
                            put("price", pricing?.formattedPrice ?: "N/A")
                            put("priceAmountMicros", pricing?.priceAmountMicros ?: 0L)
                            put("priceCurrencyCode", pricing?.priceCurrencyCode ?: "USD")
                        }
                        products.put(product)
                    }

                    val result = JSObject()
                    result.put("products", products)
                    call.resolve(result)
                } else {
                    call.reject("Failed to query products: ${billingResult.debugMessage}")
                }
            }
        }
    }

    @PluginMethod
    fun purchaseProduct(call: PluginCall) {
        synchronized(purchaseCallLock) {
            if (pendingPurchaseCall != null) {
                call.reject("Another purchase is in progress", "PURCHASE_IN_PROGRESS")
                return
            }
        }

        val productId = call.getString("productId")
        if (productId == null) {
            call.reject("productId is required")
            return
        }
        val obfuscatedAccountId = call.getString("obfuscatedAccountId")

        ensureConnected(call) {
            // First query the product details
            val productList = listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(productId)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            )

            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(productList)
                .build()

            billingClient?.queryProductDetailsAsync(params) { billingResult, queryProductDetailsResult ->
                val productDetailsList = queryProductDetailsResult.productDetailsList
                if (billingResult.responseCode != BillingClient.BillingResponseCode.OK || productDetailsList.isEmpty()) {
                    call.reject("Product not found: $productId")
                    return@queryProductDetailsAsync
                }

                val productDetails = productDetailsList[0]
                val flowBuilder = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(
                        listOf(
                            BillingFlowParams.ProductDetailsParams.newBuilder()
                                .setProductDetails(productDetails)
                                .build()
                        )
                    )

                if (!obfuscatedAccountId.isNullOrBlank()) {
                    flowBuilder.setObfuscatedAccountId(obfuscatedAccountId)
                }

                val flowParams = flowBuilder.build()

                val activity = this@BillingPlugin.activity
                synchronized(purchaseCallLock) {
                    if (pendingPurchaseCall != null) {
                        call.reject("Another purchase is in progress", "PURCHASE_IN_PROGRESS")
                        return@queryProductDetailsAsync
                    }
                    pendingPurchaseCall = call
                }

                val launchResult = billingClient?.launchBillingFlow(activity, flowParams)
                if (launchResult == null) {
                    synchronized(purchaseCallLock) {
                        if (pendingPurchaseCall === call) {
                            pendingPurchaseCall = null
                        }
                    }
                    call.reject("Failed to launch billing flow", "BILLING_LAUNCH_FAILED")
                    return@queryProductDetailsAsync
                }

                if (launchResult.responseCode != BillingClient.BillingResponseCode.OK) {
                    synchronized(purchaseCallLock) {
                        if (pendingPurchaseCall === call) {
                            pendingPurchaseCall = null
                        }
                    }
                    call.reject(
                        "Failed to launch billing flow: ${launchResult.debugMessage}",
                        "BILLING_${launchResult.responseCode}"
                    )
                }
            }
        }
    }

    @PluginMethod
    fun getPendingPurchases(call: PluginCall) {
        ensureConnected(call) {
            val params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP)
                .build()

            billingClient?.queryPurchasesAsync(params) { billingResult, purchaseList ->
                val purchases = JSArray()
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    for (purchase in purchaseList) {
                        if (!purchase.isAcknowledged) {
                            val p = JSObject().apply {
                                put("purchaseToken", purchase.purchaseToken)
                                put("productId", purchase.products[0])
                                put("orderId", purchase.orderId ?: "")
                            }
                            purchases.put(p)
                        }
                    }
                }
                val result = JSObject()
                result.put("purchases", purchases)
                call.resolve(result)
            }
        }
    }

    private fun ensureConnected(call: PluginCall, action: () -> Unit) {
        val client = billingClient
        if (client == null) {
            call.reject("Billing client is not initialized", "BILLING_NOT_INITIALIZED")
            return
        }

        if (billingClient?.isReady == true) {
            action()
        } else {
            var setupFinished = false
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    setupFinished = true
                    if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                        action()
                    } else {
                        call.reject(
                            "Billing setup failed: ${result.debugMessage}",
                            "BILLING_SETUP_${result.responseCode}"
                        )
                    }
                }

                override fun onBillingServiceDisconnected() {
                    if (!setupFinished) {
                        call.reject("Billing service disconnected", "BILLING_DISCONNECTED")
                        return
                    }
                    Log.w(TAG, "Billing service disconnected after setup during ensureConnected")
                }
            })
        }
    }

    override fun handleOnDestroy() {
        billingClient?.endConnection()
        billingClient = null
        super.handleOnDestroy()
    }
}
