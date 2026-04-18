package com.ashwah.tv

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.*
import androidx.fragment.app.FragmentActivity

class MainActivity : FragmentActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep screen on while app is open
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "AshwahTV/1.0 Android GoogleTV"
        }

        webView.webChromeClient = object : WebChromeClient() {
            // Allow autoplay without user gesture
            override fun onPermissionRequest(request: PermissionRequest) {
                request.grant(request.resources)
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Stay within the WebView for all navigation
                return false
            }
        }

        // Forward D-pad key events to the web page
        webView.setOnKeyListener { _, keyCode, event ->
            if (event.action == KeyEvent.ACTION_DOWN) {
                val jsKey = when (keyCode) {
                    KeyEvent.KEYCODE_DPAD_LEFT   -> "ArrowLeft"
                    KeyEvent.KEYCODE_DPAD_RIGHT  -> "ArrowRight"
                    KeyEvent.KEYCODE_DPAD_UP     -> "ArrowUp"
                    KeyEvent.KEYCODE_DPAD_DOWN   -> "ArrowDown"
                    KeyEvent.KEYCODE_DPAD_CENTER,
                    KeyEvent.KEYCODE_ENTER       -> "Enter"
                    else                         -> null
                }
                if (jsKey != null) {
                    webView.evaluateJavascript(
                        """document.dispatchEvent(new KeyboardEvent('keydown',{key:'$jsKey',bubbles:true,cancelable:true}));""",
                        null
                    )
                    return@setOnKeyListener true
                }
            }
            false
        }

        webView.requestFocus()
        webView.loadUrl("https://ashwahtv.pages.dev")
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Back button: tell JS first, don't use WebView history
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            webView.evaluateJavascript(
                """document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));""",
                null
            )
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.resumeTimers()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
        webView.pauseTimers()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
