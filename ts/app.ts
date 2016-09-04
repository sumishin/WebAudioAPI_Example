/// <reference path='../typings/index.d.ts' />

// 停止要因
// startメソッドのコールバックメソッドで使用する
const enum StopFactor {
    CallStop,
    Failed,
    PalyEnd
}

class TimeDomainSummaryDrawer {
    private _context: CanvasRenderingContext2D;
    private _width: number;
    private _height: number;
    private _currentX: number;

    constructor(canvas:HTMLCanvasElement) {
        this._context = canvas.getContext('2d');
        this._width = canvas.width;
        this._height = canvas.height;
        this._currentX = 0;
    }
    public draw(low:number, hi:number){

        // 波形データは, 0 ～ 255, で表現されています。 
        // 振幅が1で考えると, 1が255, 0 (無音) が128, -1が0に対応しています。
        // この関係に基づき、以下のような計算で描写すべき領域を求めます。
        var drawLow = this._height - (this._height * (low / 256)) - 1;
        var drawHi = this._height - (this._height * (hi / 256)) - 1;
        
        // x位置が右端ならクリア
        if(this._width <= this._currentX) {
            this.clear();
        }

        // 現在位置の中央部を描写
        this._context.fillStyle = '#cccccc';
        this._context.fillRect(this._currentX, this._height / 2, 1, 0.5);

        // summary描写
        this._context.fillStyle = '#ffffff';
        this._context.fillRect(this._currentX, drawLow, 1, drawHi - drawLow);

        // x位置更新
        this._currentX++;
    }
    public clear() {
        this._context.clearRect(0, 0, this._width, this._height);
        this._currentX = 0;
    }
}

class App {

    private _audioContext: AudioContext;
    private _analyser: AnalyserNode;
    private _scriptProcessor: ScriptProcessorNode;
    private _audioFileSource: AudioBufferSourceNode;
    private _microphone: MediaStreamAudioSourceNode;

    private _animationID: number;
    private _onStoped: (factor:StopFactor)=>void;

    private _drawer: TimeDomainSummaryDrawer; 
    private _amplitudeArray :Uint8Array;

    constructor(canvas:HTMLCanvasElement) {

        this._audioContext = new window.AudioContext();
        this._analyser = this._audioContext.createAnalyser();

        // 高速フーリエ変換のデータサイズは2048から減らした値を使用します。
        this._analyser.fftSize = 1024;
        this._analyser.smoothingTimeConstant = 0.9;

        // 描写を行うクラス
        this._drawer = new TimeDomainSummaryDrawer(canvas); 
    }

    // properties
    public get IsExecuting(): boolean {
        return !!(this._onStoped);
    }
    
    // public methods
    public startByFile(audioFile:File, onStart:()=>void, onStoped:(factor:StopFactor)=>void) { 
        if(this.IsExecuting) {
            throw 'is executing';
        }
        this._onStoped = onStoped;

        // TODO: Promise使いたい

        // ファイル読み込み
        let fr:FileReader = new FileReader();
        fr.addEventListener('load', ()=>{
            
            // 読み込んだ音声ファイルのデコードを非同期で行う
            this.asyncDecodeAudioData(fr.result, onStart);

        }, false);

        fr.addEventListener('error', ()=>{
            console.log(fr.error);
            this._onStoped(StopFactor.Failed);
            delete this._onStoped;
        }, false);

        fr.readAsArrayBuffer(audioFile);
    }
    public startByUserMeida(onStoped:(factor:StopFactor)=>void) { 
        if(this.IsExecuting) {
            throw 'is executing';
        }
        this._onStoped = onStoped;

        var constraints: MediaStreamConstraints =  { audio: true, video: false };
        navigator.mediaDevices.getUserMedia(constraints)
            .then(stream => {
                try {
                    // MediaStreamSourceとScriptProcessorを作成
                    this._microphone = this._audioContext.createMediaStreamSource(stream);
                    this._microphone.connect(this._analyser);

                    this._scriptProcessor = this._audioContext.createScriptProcessor(this._analyser.fftSize, 1, 1);
                    this._analyser.connect(this._scriptProcessor);
                    //this._scriptProcessor.connect(this._microphone);
                    this._scriptProcessor.onaudioprocess = () => this.onAudioProcess();

                    // 波形描写領域クリア
                    this._drawer.clear();

                } catch(e) {
                    console.log('fail use microphone', e);
                    this._onStoped(StopFactor.Failed);
                    delete this._onStoped;
                }
            })
            .catch(e => {
                console.log(e);
                this._onStoped(StopFactor.Failed);
                delete this._onStoped;
            });
    }
    public stop() {
        let callback = this._onStoped;
        delete this._onStoped;

        if(!!(this._audioFileSource)) {
            this._audioFileSource.stop(0);
            delete this._audioFileSource;
        }

        if(!!(this._microphone)) {
            this._microphone.disconnect(this._analyser);
            if(!!(this._scriptProcessor)) {
                this._scriptProcessor.disconnect(this._audioContext.destination);
                this._analyser.disconnect(this._scriptProcessor);
                delete this._scriptProcessor;
            }
            if(!!(this._animationID)) {
                window.cancelAnimationFrame(this._animationID);
                delete this._animationID;
            } 
            delete this._microphone;
        }

        callback(StopFactor.CallStop);
    }
    public IsSupported(useUserMedia:boolean): boolean {
        return !!(AudioContext ||
                 !useUserMedia ||
                 (navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
                 );
    }

    // private methods
    private asyncDecodeAudioData(data:ArrayBuffer, onStart:()=>void) {
        
        this._audioContext.decodeAudioData(data, (decodedData: AudioBuffer) => {
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

            } catch(e) {
                console.log('play failed', e);
                this._onStoped(StopFactor.Failed);
                delete this._onStoped;
            }

            // 再生開始コールバック
            onStart();

        }, () => {
            console.log('decode failed');
            this._onStoped(StopFactor.Failed);
            delete this._onStoped;
        });
    }
    private onAudioProcess() {

        this._amplitudeArray = new Uint8Array(this._analyser.frequencyBinCount);
        this._analyser.getByteTimeDomainData(this._amplitudeArray);

        if (this.IsExecuting) {
            this._animationID = window.requestAnimationFrame(() => {
                this.drawTimeDomain();
            });
        }
    }
    private onPlayEnded() {
        
        if(!!(this._scriptProcessor)) {
            this._scriptProcessor.disconnect(this._audioContext.destination);
            this._analyser.disconnect(this._scriptProcessor);
            delete this._scriptProcessor;
        }

        if(!!(this._audioFileSource)) {
            delete this._audioFileSource;
        }

        if(!!(this._animationID)) {
            window.cancelAnimationFrame(this._animationID);
            delete this._animationID;
        } 

        if(!!(this._onStoped)) {
            this._onStoped(StopFactor.PalyEnd);
            delete this._onStoped;
        }
    }
 
    private drawTimeDomain() {
        var minValue:number = Number.MAX_VALUE;
        var maxValue:number = Number.MIN_VALUE;

        // 現時点の波形データの最大値と最小値を取り出します。
        for (var i = 0; i < this._amplitudeArray.length; i++) {
            var value = this._amplitudeArray[i];
            if(value > maxValue) {
                maxValue = value;
            } else if(value < minValue) {
                minValue = value;
            }
        }

        // 波形データの最小値と最大値を指定し、drawerに描写させます。
        this._drawer.draw(minValue, maxValue);
    }
}

jQuery(document).ready(() => {

    // UIパーツ
    var jqwrapper: JQuery      = $('.wrapper');
    var jqCanvas: JQuery       = $('#canvas');
    var jqUseUserMedia: JQuery = $('#useUserMedia');
    var jqAudioFile: JQuery    = $('#audioFile');
    var jqStartButton: JQuery  = $('#startButton');
    var jqStopButton: JQuery   = $('#stopButton');

    // canvasの幅設定
    jqCanvas.prop('width', jqwrapper.width());
    jqCanvas.css('visibility', 'visible');

    // Applicationクラスのインスタンス
    var app = new App(<HTMLCanvasElement>jqCanvas.get(0));

    // マイク使用有無でUIを切り替える
    jqUseUserMedia.on('change', (e: JQueryEventObject) => {
        if(jqUseUserMedia.prop('checked')) {
            jqAudioFile.hide();
            jqStartButton.show();
        } else {
            jqAudioFile.show();
            jqStartButton.hide();
        }
    });

    jqAudioFile.on('change',(e: JQueryEventObject) => {
         
        if(app.IsSupported(false)) {
            let input:HTMLInputElement = <HTMLInputElement>e.target;
            if(0 < input.files.length) {
                let f:File = input.files.item(0);

                // 再生終了までファイル変更、チェックボックは操作不可
                jqAudioFile.prop('disabled', true);
                jqUseUserMedia.prop('disabled', true);
                
                app.startByFile(f, () => {

                    jqAudioFile.hide();
                    jqStopButton.show();

                }, (factor:StopFactor) => {

                    jqAudioFile.val('');
                    jqAudioFile.prop('disabled', false);
                    jqUseUserMedia.prop('disabled', false);

                    jqAudioFile.show();
                    jqStopButton.hide();

                    if(factor === StopFactor.Failed) {
                        alert('play audio failed');
                    } 
                });
            }
        } else {
            alert('non-support');
        }
    });

    jqStartButton.on('click',(e: JQueryEventObject) => {
        if(app.IsSupported(true)) {

            // 終了まで操作不可
            jqUseUserMedia.prop('disabled', true);

            jqStartButton.hide();
            jqStopButton.show();

            app.startByUserMeida((factor:StopFactor) => {
                jqStartButton.show();
                jqStopButton.hide();
                jqUseUserMedia.prop('disabled', false);

                if(factor === StopFactor.Failed) {
                    alert('fail use microphone');
                } 
            });

        } else {
            alert('non-support');
        }
    });
    
    jqStopButton.on('click',(e: JQueryEventObject) => {
        app.stop();
    });

});

// vender prefix 対応
(() => {
    window.AudioContext = AudioContext ||
                          webkitAudioContext;
    window.requestAnimationFrame = window.requestAnimationFrame || 
                                   (<any>window).webkitRequestAnimationFrame || 
                                   (<any>window).mozRequestAnimationFrame || 
                                   (<any>window).oRequestAnimationFrame || 
                                   window.msRequestAnimationFrame || 
                                   function(callback){ 
                                       window.setTimeout(callback, 1000 / 60); 
                                   };
    window.cancelAnimationFrame = window.cancelAnimationFrame ||
                                  (<any>window).cancelRequestAnimationFrame ||
                                  (<any>window).webkitCancelAnimationFrame ||
                                  (<any>window).webkitCancelRequestAnimationFrame ||
                                  (<any>window).mozCancelAnimationFrame ||
                                  (<any>window).mozCancelRequestAnimationFrame ||
                                  (<any>window).msCancelAnimationFrame ||
                                  window.msCancelRequestAnimationFrame ||
                                  (<any>window).oCancelAnimationFrame ||
                                  (<any>window).oCancelRequestAnimationFrame ||
                                  function(id) { 
                                      window.clearTimeout(id); 
                                  };
})();