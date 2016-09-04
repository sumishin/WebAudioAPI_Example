/// <reference path='../typings/index.d.ts' />
class TimeDomainSummaryDrawer {
    constructor(canvas) {
        this._context = canvas.getContext('2d');
        this._width = canvas.width;
        this._height = canvas.height;
        this._currentX = 0;
    }
    draw(low, hi) {
        // 波形データは, 0 ～ 255, で表現されています。 
        // 振幅が1で考えると, 1が255, 0 (無音) が128, -1が0に対応しています。
        // この関係に基づき、以下のような計算で描写すべき領域を求めます。
        var drawLow = this._height - (this._height * (low / 256));
        var drawHi = this._height - (this._height * (hi / 256));
        // x位置が幅を超えているようならクリア
        if (this._width < this._currentX) {
            this.clear();
        }
        // 現在位置の中央部を描写
        this._context.fillStyle = '#cccccc';
        this._context.fillRect(this._currentX, this._height / 2, 1, 1);
        // summary描写
        this._context.fillStyle = '#ffffff';
        this._context.fillRect(this._currentX, drawLow, 1, drawHi - drawLow);
        // x位置更新
        this._currentX++;
    }
    clear() {
        this._context.clearRect(0, 0, this._width, this._height);
        this._currentX = 0;
    }
}
class App {
    constructor(canvas) {
        this._audioContext = new window.AudioContext();
        this._analyser = this._audioContext.createAnalyser();
        // 高速フーリエ変換のデータサイズは2048から減らした値を使用します。
        this._analyser.fftSize = 1024;
        this._analyser.smoothingTimeConstant = 0.9;
        // 描写を行うクラス
        this._drawer = new TimeDomainSummaryDrawer(canvas);
    }
    // properties
    get IsExecuting() {
        return !!(this._onStoped);
    }
    // public methods
    startByFile(audioFile, onStart, onStoped) {
        if (this.IsExecuting) {
            throw 'is executing';
        }
        this._onStoped = onStoped;
        // TODO: Promise使いたい
        // ファイル読み込み
        let fr = new FileReader();
        fr.addEventListener('load', () => {
            // 読み込んだ音声ファイルのデコードを非同期で行う
            this.asyncDecodeAudioData(fr.result, onStart);
        }, false);
        fr.addEventListener('error', () => {
            console.log(fr.error);
            this._onStoped(1 /* Failed */);
            delete this._onStoped;
        }, false);
        fr.readAsArrayBuffer(audioFile);
    }
    startByUserMeida(onStoped) {
        if (this.IsExecuting) {
            throw 'is executing';
        }
        this._onStoped = onStoped;
        var constraints = { audio: true, video: false };
        navigator.mediaDevices.getUserMedia(constraints)
            .then(stream => {
            try {
                // MediaStreamSourceとScriptProcessorを作成
                this._microphone = this._audioContext.createMediaStreamSource(stream);
                this._microphone.connect(this._analyser);
                this._scriptProcessor = this._audioContext.createScriptProcessor(this._analyser.fftSize, 1, 1);
                this._analyser.connect(this._scriptProcessor);
                this._scriptProcessor.onaudioprocess = () => this.onAudioProcess();
                // 波形描写領域クリア
                this._drawer.clear();
            }
            catch (e) {
                console.log('fail use microphone', e);
                this._onStoped(1 /* Failed */);
                delete this._onStoped;
            }
        })
            .catch(e => {
            console.log(e);
            this._onStoped(1 /* Failed */);
            delete this._onStoped;
        });
    }
    stop() {
        let callback = this._onStoped;
        delete this._onStoped;
        if (!!(this._audioFileSource)) {
            this._audioFileSource.stop(0);
            delete this._audioFileSource;
        }
        if (!!(this._microphone)) {
            this._microphone.disconnect(this._analyser);
            if (!!(this._scriptProcessor)) {
                this._scriptProcessor.disconnect(this._audioContext.destination);
                this._analyser.disconnect(this._scriptProcessor);
                delete this._scriptProcessor;
            }
            if (!!(this._animationID)) {
                window.cancelAnimationFrame(this._animationID);
                delete this._animationID;
            }
            delete this._microphone;
        }
        callback(0 /* CallStop */);
    }
    IsSupported(useUserMedia) {
        return !!(AudioContext ||
            !useUserMedia ||
            (navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
    }
    // private methods
    asyncDecodeAudioData(data, onStart) {
        this._audioContext.decodeAudioData(data, (decodedData) => {
            try {
                // BufferSourceとScriptProcessorを作成
                this._audioFileSource = this._audioContext.createBufferSource();
                this._audioFileSource.buffer = decodedData;
                this._audioFileSource.connect(this._audioContext.destination);
                this._audioFileSource.connect(this._analyser);
                this._audioFileSource.onended = () => this.onPlayEnded();
                this._scriptProcessor = this._audioContext.createScriptProcessor(this._analyser.fftSize, 1, 1);
                this._analyser.connect(this._scriptProcessor);
                this._scriptProcessor.connect(this._audioContext.destination);
                this._scriptProcessor.onaudioprocess = () => this.onAudioProcess();
                // 波形描写領域クリア
                this._drawer.clear();
                // 再生
                this._audioFileSource.start(0);
            }
            catch (e) {
                console.log('play failed', e);
                this._onStoped(1 /* Failed */);
                delete this._onStoped;
            }
            // 再生開始コールバック
            onStart();
        }, () => {
            console.log('decode failed');
            this._onStoped(1 /* Failed */);
            delete this._onStoped;
        });
    }
    onAudioProcess() {
        this._amplitudeArray = new Uint8Array(this._analyser.frequencyBinCount);
        this._analyser.getByteTimeDomainData(this._amplitudeArray);
        if (this.IsExecuting) {
            if (!!this._animationID) {
                window.cancelAnimationFrame(this._animationID);
            }
            this._animationID = window.requestAnimationFrame(() => {
                this.drawTimeDomain();
                delete this._animationID;
            });
        }
    }
    onPlayEnded() {
        if (!!(this._scriptProcessor)) {
            this._scriptProcessor.disconnect(this._audioContext.destination);
            this._analyser.disconnect(this._scriptProcessor);
            delete this._scriptProcessor;
        }
        if (!!(this._audioFileSource)) {
            delete this._audioFileSource;
        }
        if (!!(this._animationID)) {
            window.cancelAnimationFrame(this._animationID);
            delete this._animationID;
        }
        if (!!(this._onStoped)) {
            this._onStoped(2 /* PalyEnd */);
            delete this._onStoped;
        }
    }
    drawTimeDomain() {
        var minValue = Number.MAX_VALUE;
        var maxValue = Number.MIN_VALUE;
        // 現時点の波形データの最大値と最小値を取り出します。
        for (var i = 0; i < this._amplitudeArray.length; i++) {
            var value = this._amplitudeArray[i];
            if (value > maxValue) {
                maxValue = value;
            }
            else if (value < minValue) {
                minValue = value;
            }
        }
        // 波形データの最小値と最大値を指定し、drawerに描写させます。
        this._drawer.draw(minValue, maxValue);
    }
}
jQuery(document).ready(() => {
    // UIパーツ
    var jqwrapper = $('.wrapper');
    var jqCanvas = $('#canvas');
    var jqUseUserMedia = $('#useUserMedia');
    var jqAudioFile = $('#audioFile');
    var jqStartButton = $('#startButton');
    var jqStopButton = $('#stopButton');
    // canvasの幅設定
    jqCanvas.prop('width', jqwrapper.width());
    jqCanvas.css('visibility', 'visible');
    // Applicationクラスのインスタンス
    var app = new App(jqCanvas.get(0));
    // マイク使用有無でUIを切り替える
    jqUseUserMedia.on('change', (e) => {
        if (jqUseUserMedia.prop('checked')) {
            jqAudioFile.hide();
            jqStartButton.show();
        }
        else {
            jqAudioFile.show();
            jqStartButton.hide();
        }
    });
    jqAudioFile.on('change', (e) => {
        if (app.IsSupported(false)) {
            let input = e.target;
            if (0 < input.files.length) {
                let f = input.files.item(0);
                // 再生終了までファイル変更、チェックボックは操作不可
                jqAudioFile.prop('disabled', true);
                jqUseUserMedia.prop('disabled', true);
                app.startByFile(f, () => {
                    jqAudioFile.hide();
                    jqStopButton.show();
                }, (factor) => {
                    jqAudioFile.val('');
                    jqAudioFile.prop('disabled', false);
                    jqUseUserMedia.prop('disabled', false);
                    jqAudioFile.show();
                    jqStopButton.hide();
                    if (factor === 1 /* Failed */) {
                        alert('play audio failed');
                    }
                });
            }
        }
        else {
            alert('non-support');
        }
    });
    jqStartButton.on('click', (e) => {
        if (app.IsSupported(true)) {
            // 終了まで操作不可
            jqUseUserMedia.prop('disabled', true);
            jqStartButton.hide();
            jqStopButton.show();
            app.startByUserMeida((factor) => {
                jqStartButton.show();
                jqStopButton.hide();
                jqUseUserMedia.prop('disabled', false);
                if (factor === 1 /* Failed */) {
                    alert('fail use microphone');
                }
            });
        }
        else {
            alert('non-support');
        }
    });
    jqStopButton.on('click', (e) => {
        app.stop();
    });
});
// vender prefix 対応
(() => {
    window.AudioContext = AudioContext ||
        webkitAudioContext;
    window.requestAnimationFrame = window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        window.oRequestAnimationFrame ||
        window.msRequestAnimationFrame ||
        function (callback) {
            window.setTimeout(callback, 1000 / 60);
        };
    window.cancelAnimationFrame = window.cancelAnimationFrame ||
        window.cancelRequestAnimationFrame ||
        window.webkitCancelAnimationFrame ||
        window.webkitCancelRequestAnimationFrame ||
        window.mozCancelAnimationFrame ||
        window.mozCancelRequestAnimationFrame ||
        window.msCancelAnimationFrame ||
        window.msCancelRequestAnimationFrame ||
        window.oCancelAnimationFrame ||
        window.oCancelRequestAnimationFrame ||
        function (id) {
            window.clearTimeout(id);
        };
})();
//# sourceMappingURL=app.js.map